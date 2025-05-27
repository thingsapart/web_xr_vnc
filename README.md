# A browser-based VNC client for XR headsets based on noVNC

The idea is to create a quickish-and-dirty XR desktop client proof of concept. The goal is to get it running on Android with Termux (or the new Android 16 AVM/pKVM Terminal) and a VNC server to have a reasonable VR/XR Linux system in your pocket.

Instead of integrating fully with X11/Wayland or display managers, it just takes a (large) VNC view and applies XR view-panning/head-tracking to that. A plan is to eventually allow "breaking up" a single view into tiles to emulate separate desktops if desired.

An Android app is work-in-prorgress, the current app is using Viture XR glasses and Viture SDK to auto-pan the workspace.

# Screenshots

![Curved XR View](https://github.com/thingsapart/web_xr_vnc/blob/main/docs/curved.jpeg?raw=true)

![Flat View Zoomed Out](https://github.com/thingsapart/web_xr_vnc/blob/main/docs/flat.jpeg?raw=true)

![Full View Curved](https://github.com/thingsapart/web_xr_vnc/blob/main/docs/full_view.jpeg?raw=true)

![The Basic Menu](https://github.com/thingsapart/web_xr_vnc/blob/main/docs/menu.jpeg?raw=true)


# Keyboard Shortcuts

* Shift+Alt+Meta and drag mouse => pan view,
* Shift+Alt+Meta and scroll up/down => zoom view.

# Pre-requisites

* VNC server with Websockets support
  * QEmu is supposed to work out-of-the-box afaict, 
  * I used TightVNC (TigerVNC should work as well), but it needs a TCP/Websocket bridge server like [WSTCP](https://github.com/sile/wstcp) or Websocketify.

# Trying it

* Macos:
  * `python3 -m http.server 8080 --bind 127.0.0.1 --directory .`
  * set up your VNC, run it and run the TCP/Websocket bridge if needed - I used a resolution of 3840x1080 to have a nice large workspace without having to use virtual desktops,
  * Open `http://localhost:8080/index_B.html` and connect to your VNC server.
