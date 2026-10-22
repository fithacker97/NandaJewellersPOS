import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { disconnectScanner, isClosedConnection, pairScanner, parsePairingQr, scannerStatus, sendScan, type Connection, type ScanResult, type ScannerError } from './src/scannerApi';

type Linked = Connection & { serverUrl: string };
type Stage = 'restoring' | 'pair' | 'connecting' | 'scan' | 'sending' | 'result';
type PendingScan = { barcode: string; eventKey: string };

const colors = { green: '#163d2d', deep: '#102e23', sage: '#dce8dd', cream: '#f7f5ef', white: '#ffffff', ink: '#1c2c23', muted: '#67746a', line: '#d9dfd7', gold: '#ad8550', red: '#9c3930' };
const connectionKey = 'nanda.scanner.connection';

function Button({ label, onPress, kind = 'primary', disabled = false }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'quiet'; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, kind === 'secondary' ? styles.secondaryButton : kind === 'quiet' ? styles.quietButton : styles.primaryButton, (pressed || disabled) && styles.buttonDim]}>
    <Text style={[styles.buttonText, kind === 'primary' ? styles.primaryButtonText : styles.secondaryButtonText]}>{label}</Text>
  </Pressable>;
}

function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Try again.'; }
function eventKey() { return [Date.now().toString(36), Math.random().toString(36).slice(2), Math.random().toString(36).slice(2)].join('-'); }
function savedConnection(value: string): Linked | null {
  try {
    const candidate = JSON.parse(value) as Record<string, unknown>;
    if (typeof candidate.serverUrl !== 'string' || new URL(candidate.serverUrl).origin !== candidate.serverUrl || !/^https?:\/\//.test(candidate.serverUrl) || typeof candidate.token !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.token) || typeof candidate.connectionId !== 'string' || typeof candidate.cashierName !== 'string') return null;
    return candidate as Linked;
  } catch { return null; }
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>('restoring');
  const [linked, setLinked] = useState<Linked | null>(null);
  const [online, setOnline] = useState(true);
  const [manual, setManual] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [torch, setTorch] = useState(false);
  const [pending, setPending] = useState<PendingScan | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [cameraKey, setCameraKey] = useState(0);
  const gate = useRef(false);

  const reset = useCallback(async (reason = '') => {
    await SecureStore.deleteItemAsync(connectionKey).catch(() => undefined);
    gate.current = false;
    setLinked(null);
    setOnline(true);
    setPending(null);
    setResult(null);
    setManual(false);
    setManualBarcode('');
    setTorch(false);
    setError(reason);
    setStage('pair');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let saved: string | null;
      try { saved = await SecureStore.getItemAsync(connectionKey); }
      catch (failure) { if (!cancelled) { setError(message(failure)); setStage('pair'); } return; }
      if (cancelled) return;
      if (!saved) { setStage('pair'); return; }
      const candidate = savedConnection(saved);
      if (!candidate) { await reset('Saved scanner connection was invalid. Pair again.'); return; }
      try {
        const status = await scannerStatus(candidate.serverUrl, candidate.token);
        if (cancelled) return;
        setLinked({ ...candidate, cashierName: status.cashierName });
        setOnline(true);setStage('scan');
      } catch (failure) {
        if (cancelled) return;
        if (isClosedConnection(failure)) await reset('The phone was disconnected. Pair it again.');
        else { setLinked(candidate); setOnline(false); setError(message(failure)); setStage('scan'); }
      }
    })();
    return () => { cancelled = true; };
  }, [reset]);

  const checkConnection = useCallback(async () => {
    if (!linked) return;
    try {
      await scannerStatus(linked.serverUrl, linked.token);
      setOnline(true);
      setError('');
    } catch (failure) {
      if (isClosedConnection(failure)) await reset(message(failure));
      else { setOnline(false); setError(message(failure)); }
    }
  }, [linked, reset]);

  useEffect(() => {
    if (!linked) return;
    const timer = setInterval(() => { void checkConnection(); }, 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void checkConnection(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [linked, checkConnection]);

  const handlePair = async (data: string) => {
    if (gate.current) return;
    gate.current = true;
    setError('');
    let pairing;
    try { pairing = parsePairingQr(data); }
    catch (failure) {
      setError(message(failure));
      setTimeout(() => { gate.current = false; }, 1200);
      return;
    }
    setStage('connecting');
    try {
      const connection = await pairScanner(pairing);
      const next = { ...connection, serverUrl: pairing.serverUrl };
      try { await SecureStore.setItemAsync(connectionKey, JSON.stringify(next)); }
      catch { setError('Phone paired, but this device could not save the connection for the next app launch.'); }
      setLinked(next);
      setOnline(true);
      setStage('scan');
      gate.current = false;
    } catch (failure) {
      setError(message(failure));
      setStage('pair');
      setTimeout(() => { gate.current = false; }, 1200);
    }
  };

  const deliver = async (scan: PendingScan, connection: Linked) => {
    setPending(scan);
    setResult(null);
    setError('');
    setStage('sending');
    try {
      const answer = await sendScan(connection.serverUrl, connection.token, scan.barcode, scan.eventKey);
      setResult(answer);
      setPending(null);
      setOnline(true);
      setStage('result');
    } catch (failure) {
      if (isClosedConnection(failure)) { await reset(message(failure)); return; }
      const apiError = failure as ScannerError;
      if (apiError.status) setPending(null);
      else setOnline(false);
      setError(message(failure));
      setStage('result');
    }
  };

  const handleProduct = (barcode: string) => {
    if (gate.current || !linked || !online) return;
    const trimmed = barcode.trim();
    if (!trimmed || trimmed.length > 100) { setError('Enter a barcode with 1 to 100 characters.'); return; }
    gate.current = true;
    setManualBarcode('');
    void deliver({ barcode: trimmed, eventKey: eventKey() }, linked);
  };

  const nextScan = () => {
    gate.current = false;
    setPending(null);
    setResult(null);
    setError('');
    setManual(false);
    setStage('scan');
    if (!online) void checkConnection();
  };

  const requestDisconnect = () => {
    if (!linked) return;
    Alert.alert('Disconnect scanner?', 'The phone will need a new pairing QR to scan again.', [
      { text: 'Keep connected', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => { void disconnectScanner(linked.serverUrl, linked.token).then(() => reset()).catch(failure => { if (isClosedConnection(failure)) void reset(); else setError(message(failure)); }); } },
    ]);
  };

  const cameraVisible = (stage === 'pair' || (stage === 'scan' && online && !manual)) && permission?.granted;
  const showCamera = stage === 'pair' || stage === 'scan';
  const onScanned = (data: BarcodeScanningResult) => { if (stage === 'pair') void handlePair(data.data); else handleProduct(data.data); };

  return <SafeAreaProvider><SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    <View style={styles.header}>
      <View><Text style={styles.brand}>NANDA</Text><Text style={styles.brandSub}>SHOWROOM SCANNER</Text></View>
      {linked && <View style={[styles.statusPill, !online && styles.offlinePill]}><View style={[styles.statusDot, !online && styles.offlineDot]} /><Text style={styles.statusText}>{online ? 'Connected' : 'Offline'}</Text></View>}
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>{stage === 'restoring' || stage === 'pair' || stage === 'connecting' ? '01 / CONNECT' : '02 / SCAN PRODUCTS'}</Text>
      <Text style={styles.title}>{stage === 'restoring' ? 'Restoring scanner…' : stage === 'pair' ? 'Pair your phone' : stage === 'connecting' ? 'Connecting…' : stage === 'sending' ? 'Adding to bill…' : stage === 'result' ? result ? 'Added to bill' : 'Scan not added' : 'Scan a product'}</Text>
      <Text style={styles.subtitle}>{stage === 'pair' ? 'Open Make a bill on the computer, tap Pair phone, and scan its QR code here.' : stage === 'connecting' || stage === 'restoring' ? 'Checking the connection with your computer.' : linked ? `Billing with ${linked.cashierName}` : ''}</Text>

      <View style={styles.cameraShell}>
        {permission?.granted && stage !== 'restoring' && <CameraView key={cameraKey} style={StyleSheet.absoluteFill} facing="back" active={!!cameraVisible} enableTorch={stage === 'scan' && torch} barcodeScannerSettings={{ barcodeTypes: stage === 'pair' ? ['qr'] : ['code39', 'code128', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code93', 'itf14', 'codabar', 'qr'] }} onBarcodeScanned={cameraVisible ? onScanned : undefined} onMountError={event => setCameraError(event.message)} onCameraReady={() => setCameraError('')} />}
        {showCamera ? <>
          {!cameraVisible && <View style={[StyleSheet.absoluteFill, styles.cameraPlaceholder]}>
            {stage === 'scan' && manual ? <><Text style={styles.placeholderSymbol}>⌨</Text><Text style={styles.placeholderTitle}>Manual entry</Text><Text style={styles.placeholderBody}>Type the code printed below the product barcode.</Text></> : !permission?.granted ? <><Text style={styles.placeholderSymbol}>▥</Text><Text style={styles.placeholderTitle}>Camera access needed</Text><Text style={styles.placeholderBody}>Allow the camera to scan pairing QR codes and product labels.</Text><Button label={permission?.canAskAgain === false ? 'Open settings' : 'Allow camera'} onPress={() => { if (permission?.canAskAgain === false) void Linking.openSettings(); else void requestPermission(); }} /></> : <><ActivityIndicator color={colors.white} /><Text style={styles.placeholderBody}>Checking the computer connection…</Text></>}
          </View>}
          {cameraVisible && <View pointerEvents="none" style={styles.cameraOverlay}><View style={styles.scanFrame}><View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} /><View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} /></View><Text style={styles.cameraHint}>{stage === 'pair' ? 'PLACE PAIRING QR IN FRAME' : 'ALIGN BARCODE WITH FRAME'}</Text></View>}
        </> : <View style={[StyleSheet.absoluteFill, styles.feedbackCard]}>
        {stage === 'restoring' || stage === 'connecting' || stage === 'sending' ? <><ActivityIndicator size="large" color={colors.green} /><Text style={styles.feedbackTitle}>{stage === 'restoring' ? 'Restoring connection' : stage === 'connecting' ? 'Pairing with computer' : 'Sending scan'}</Text><Text style={styles.feedbackBody}>Keep the app open for a moment.</Text></> : result ? <><View style={styles.successMark}><Text style={styles.successMarkText}>✓</Text></View><Text style={styles.feedbackTitle}>{result.productName}</Text><Text style={styles.feedbackBody}>1 piece added to the current bill.</Text><View style={styles.resultStats}><View><Text style={styles.statLabel}>THIS PRODUCT IN BILL</Text><Text style={styles.statValue}>{result.quantity}</Text></View><View style={styles.statDivider} /><View><Text style={styles.statLabel}>ALL BILL PIECES</Text><Text style={styles.statValue}>{result.totalPieces}</Text></View></View></> : <><Text style={styles.errorMark}>!</Text><Text style={styles.feedbackTitle}>{pending ? 'Delivery uncertain' : 'Item not added'}</Text><Text style={styles.feedbackBody}>{pending ? 'The computer may have received this scan. Retry the same scan to check safely.' : 'Check the barcode or product stock, then scan again.'}</Text></>}
        </View>}
      </View>

      {!!error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}
      {!!cameraError && <View style={styles.errorBanner}><Text style={styles.errorText}>Camera could not start: {cameraError}</Text></View>}

      {stage === 'pair' && <View style={styles.instructions}><Text style={styles.sectionLabel}>HOW TO CONNECT</Text><Text style={styles.instruction}>1. Keep the computer and phone on the same Wi-Fi.</Text><Text style={styles.instruction}>2. On the computer, open Make a bill → Pair phone.</Text><Text style={styles.instruction}>3. Scan the QR shown on the computer.</Text></View>}

      {stage === 'scan' && linked && <View style={styles.actions}>
        {!online ? <Button label="Retry connection" onPress={() => { void checkConnection(); }} /> : manual ? <><Text style={styles.fieldLabel}>PRODUCT BARCODE</Text><TextInput style={styles.input} placeholder="Enter code on product tag" placeholderTextColor={colors.muted} value={manualBarcode} onChangeText={setManualBarcode} autoCapitalize="characters" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => handleProduct(manualBarcode)} /><Button label="Add to bill" disabled={!manualBarcode.trim()} onPress={() => handleProduct(manualBarcode)} /><Button label="Use camera" kind="quiet" onPress={() => { setManual(false); setError(''); }} /></> : <><Button label={torch ? 'Turn light off' : 'Turn light on'} kind="secondary" onPress={() => setTorch(!torch)} /><Button label="Enter barcode manually" kind="quiet" onPress={() => { setManual(true); setTorch(false); setError(''); }} /><Button label="Restart camera" kind="quiet" onPress={() => { setCameraError(''); setCameraKey(key => key + 1); }} /></>}
      </View>}

      {stage === 'result' && <View style={styles.actions}>{pending && linked ? <Button label="Retry same scan" onPress={() => { void deliver(pending, linked); }} /> : <Button label="Scan next barcode" onPress={nextScan} />}{pending && <Text style={styles.retryNote}>Retry keeps the same scan ID, so a delayed response cannot add a second item.</Text>}</View>}

      {linked && <View style={styles.connectionCard}><View><Text style={styles.sectionLabel}>CONNECTED COMPUTER</Text><Text style={styles.connectionHost}>{linked.serverUrl.replace(/^https?:\/\//, '')}</Text><Text style={styles.connectionMeta}>Stays paired across bills until you disconnect or sign out.</Text></View><Button label="Disconnect" kind="quiet" onPress={requestDisconnect} /></View>}
    </ScrollView>
    <View style={styles.footer}><Text style={styles.footerText}>Scans add to the draft. Save the final bill on the computer.</Text></View>
  </SafeAreaView></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.deep },
  scroll: { backgroundColor: colors.cream },
  header: { backgroundColor: colors.deep, paddingHorizontal: 25, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.white, fontSize: 23, fontWeight: '800', letterSpacing: 4 }, brandSub: { color: '#bad0bf', fontSize: 9, fontWeight: '700', letterSpacing: 2.1, marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: '#28503d' }, offlinePill: { backgroundColor: '#5b3b32' }, statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a7e7ae' }, offlineDot: { backgroundColor: '#f2a8a1' }, statusText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  content: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 32 }, eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '800', letterSpacing: 2 }, title: { color: colors.ink, fontSize: 34, fontWeight: '700', letterSpacing: -1.2, marginTop: 9 }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  cameraShell: { height: 345, backgroundColor: colors.deep, borderRadius: 18, overflow: 'hidden', justifyContent: 'center' }, cameraPlaceholder: { alignItems: 'center', justifyContent: 'center', padding: 28, flex: 1 }, placeholderSymbol: { color: colors.white, fontSize: 54, marginBottom: 8 }, placeholderTitle: { color: colors.white, fontSize: 19, fontWeight: '700', textAlign: 'center' }, placeholderBody: { color: '#c3d1c8', textAlign: 'center', lineHeight: 20, fontSize: 13, marginTop: 8, marginBottom: 18 },
  cameraOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingTop: 25 }, scanFrame: { width: '76%', height: 168 }, corner: { width: 31, height: 31, borderColor: colors.white, position: 'absolute' }, topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 }, topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 }, bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 }, bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 }, cameraHint: { color: colors.white, backgroundColor: '#18392bd9', overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginTop: 35, fontWeight: '800', fontSize: 10, letterSpacing: 1.2 },
  feedbackCard: { minHeight: 302, backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', padding: 26 }, feedbackTitle: { color: colors.ink, fontSize: 23, fontWeight: '700', textAlign: 'center', marginTop: 15 }, feedbackBody: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 7 }, successMark: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' }, successMarkText: { color: colors.green, fontSize: 32, fontWeight: '700' }, errorMark: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#f9e5e1', color: colors.red, textAlign: 'center', textAlignVertical: 'center', fontSize: 32, fontWeight: '700' }, resultStats: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', borderTopColor: colors.line, borderTopWidth: 1, marginTop: 26, paddingTop: 18 }, statLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textAlign: 'center' }, statValue: { color: colors.green, fontSize: 27, fontWeight: '700', textAlign: 'center', marginTop: 3 }, statDivider: { width: 1, height: 34, backgroundColor: colors.line },
  errorBanner: { backgroundColor: '#fbebe8', borderColor: '#edcfc8', borderWidth: 1, borderRadius: 10, padding: 13, marginTop: 15 }, errorText: { color: colors.red, fontSize: 13, lineHeight: 19 }, instructions: { marginTop: 25, paddingHorizontal: 3 }, sectionLabel: { color: colors.gold, fontWeight: '800', fontSize: 10, letterSpacing: 1.7 }, instruction: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: 10 },
  actions: { marginTop: 18, gap: 10 }, button: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 }, primaryButton: { backgroundColor: colors.green }, secondaryButton: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1 }, quietButton: { backgroundColor: 'transparent' }, buttonDim: { opacity: 0.6 }, buttonText: { fontSize: 14, fontWeight: '700' }, primaryButtonText: { color: colors.white }, secondaryButtonText: { color: colors.green }, fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }, input: { height: 52, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 15, color: colors.ink, fontSize: 16 }, retryNote: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  connectionCard: { marginTop: 28, paddingTop: 18, borderTopColor: colors.line, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, connectionHost: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 5 }, connectionMeta: { color: colors.muted, fontSize: 11, marginTop: 3, maxWidth: 210 }, footer: { borderTopColor: colors.line, borderTopWidth: 1, paddingHorizontal: 20, paddingVertical: 11, backgroundColor: colors.cream }, footerText: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
