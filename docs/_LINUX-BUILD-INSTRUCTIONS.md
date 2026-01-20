# Linux Build & Runtime Instructions

## Prerequisites

### AppImage Support (Required for Ubuntu 22.04+)
If your AppImage does not open (even if marked executable), or you see FUSE errors, you likely need to install `libfuse2`.

Run the following command:
```bash
sudo apt install libfuse2
```
*Note: Ubuntu 22.04 moved to FUSE3 by default, but AppImages currently require FUSE2.*

**Troubleshooting "unable to locate package libfuse2":**
If you see this error, it might be because your distribution uses `libfuse2t64` (like newer Ubuntu versions).
You can check if it's already installed with `apt list libfuse2t64`.

If you still need the original library, ensure the `universe` repository is enabled:
```bash
sudo add-apt-repository universe
sudo apt update
sudo apt install libfuse2
```

**Other Distributions:**
*   **Fedora/RedHat:** `sudo dnf install fuse` or `sudo dnf install fuse-libs`
*   **Arch Linux:** `sudo pacman -S fuse2`

**Workaround (Run without FUSE):**
If you cannot install FUSE, you can run the AppImage directly by extracting it on the fly:
```bash
./YourApp.AppImage --appimage-extract-and-run
```

### Build Dependencies
Ensure you have the necessary build tools installed:
```bash
sudo apt-get install build-essential libssl-dev
```

## Icons on Linux
Linux desktop environments (GNOME, KDE, etc.) handle icons differently than Windows or macOS.

*   **Window Icon:** The icon in the title bar or dock while the app is running. This is handled by `main.js` loading `assets/icon.png`.
*   **App Icon (File Manager / Launcher):** The icon you see for the installed app or the AppImage file. This is handled by the `package.json` configuration and the `.desktop` file metadata.

If your icon is missing in the file manager or launcher:
1.  **Clear Icon Cache:** Sometimes the system caches the old default icon.
    ```bash
    gtk-update-icon-cache
    ```
    Or try moving the AppImage to a new location.
2.  **AppImage Integration:** AppImages don't automatically "install" their icon into the system theme unless you use a tool like "AppImageLauncher". Without it, you might only see the generic executable icon until you run it.

## Building for Linux

To build for Linux (AppImage, deb, rpm):

```bash
npm run build:linux
```

The artifacts will be in the `dist` directory.
