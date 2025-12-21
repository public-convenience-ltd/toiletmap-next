# Toilet Map Mobile App

This project uses data from https://www.toiletmap.org.uk/ to allow users to find nearby toilets. A search screen provides a way of searching for toilets in other areas.

## Prerequisites

To develop the mobile app, you need the **Flutter SDK** installed on your machine.

1. **Install Flutter SDK**:
   
   **macOS (Homebrew):**
   ```bash
   brew install --cask flutter
   ```

   **Linux (Snap):**
   ```bash
   sudo snap install flutter --classic
   ```

   **Windows (Chocolatey):**
   ```bash
   choco install flutter
   ```

   **Manual Download:**
   - Visit [flutter.dev/install](https://docs.flutter.dev/get-started/install) and download the SDK for your OS.
2. **Add to PATH**: Ensure `flutter` is available in your terminal.
   ```bash
   flutter --version
   ```
3. **Setup**: Run `make setup-app` from the repo root to install dependencies.

## Using the project

- Clone the project
- Run `flutter pub get`
- Run the app on an emulator or mobile device
