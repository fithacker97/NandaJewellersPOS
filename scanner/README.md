# Nanda Scanner

This Expo phone app pairs with the Nanda Showroom billing screen and adds product barcodes to the cashier's current invoice draft. It cannot issue a bill; the cashier reviews and saves the bill on the computer.

## Run on a phone

1. Start the showroom from `../backend` with `npm start`.
2. Install dependencies here with `npm install`, then run `npm start`.
3. Open the Metro QR with Expo Go on a phone. Keep phone and computer on the same Wi-Fi.
4. In the showroom, open **Make a bill → Pair phone** and show its pairing QR.
5. In this app, allow camera access and scan the showroom QR. Then scan product labels or choose **Enter barcode manually**.

The pairing QR includes the computer's LAN API address, so no server address or cashier credentials are entered on the phone. Pairing expires after five minutes. The phone securely remembers its connection across app restarts and bills. Saving or clearing a bill starts a fresh bill on the next scan without disconnecting the phone. Disconnect on the phone or computer, or sign out on the computer, to end the connection.

If the phone cannot reach the showroom, check that the backend is running and both devices are on the same network. The showroom pairing dialog can offer multiple network addresses; select the one matching the phone's Wi-Fi. Expo Go is the development target. A standalone Android build using the showroom's local HTTP address needs a cleartext network configuration; use HTTPS when deploying remotely.

`npm run typecheck` checks the app. Camera and local network behavior still need a physical-phone test.
