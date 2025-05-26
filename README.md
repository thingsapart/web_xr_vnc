
# Pre-requisites

* VNC server with Websockets support
  * QEmu is supposed to work out-of-the-box afaict, 
  * I used TightVNC (TigerVNC should work as well), but it needs a TCP/Websocket bridge server like [https://github.com/sile/wstcp](WSTCP) or Websocketify.

# Trying it

* Macos:
  * `python3 -m http.server 8080 --bind 127.0.0.1 --directory .`
  * set up your VNC, run it and run the TCP/Websocket bridge if needed,
  * Open `http://localhost:8080/index_B.html` and connect to your VNC server.
