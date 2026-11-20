# Banana Send

**Send anything. Anywhere.**

Cross-platform unlimited file and folder sharing for **Windows 10/11** and **Android**.

## 1. Local Development & Signaling Server

`.npmrc` is preconfigured with `legacy-peer-deps=true` so first-time installation completes cleanly with zero peer dependency errors:

```bash
npm install
npm run dev
```

## 2. Build Windows `.exe` Automatically

Double-click **`build-windows-exe.bat`** in the project root (or run it from Command Prompt).

It automatically:
1. Installs dependencies cleanly (`npm install`).
2. Builds the production web bundle (`npm run build`).
3. Installs Electron & `electron-builder` if not present.
4. Packages both **`Banana Send Setup 0.0.0.exe`** (Windows installer) and **`Banana-Send-Portable.exe`** with the custom Windows icon (`build/icon.ico`) into **`dist-windows/`**.

## 3. Build Android `.apk` in Android Studio

The complete Android Studio project is located in **`android/`**, pre-populated with:
- Launcher & Adaptive Icons (`android/app/src/main/res/mipmap-*`)
- Bundled web assets (`android/app/src/main/assets/www/`)
- Native file chooser, QR camera permissions, and MediaStore Downloads saving (`MainActivity.java`)

### Steps:
1. Open **Android Studio** -> **Open** -> select the **`android/`** folder inside this repository.
2. Wait for Gradle Sync to automatically download Gradle 8.7 and AndroidX dependencies.
3. Click **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. Install the generated `.apk` from `android/app/build/outputs/apk/debug/app-debug.apk`.

If you modify the web UI later, run `npm run sync:android` before rebuilding the APK in Android Studio.
