#!/bin/sh
# Runs at container startup (via nginx's /docker-entrypoint.d hook) before nginx
# launches. Generates a self-signed certificate into the mounted cert directory
# if none is present, so HTTPS works out of the box for local development.
# Drop your own server.crt / server.key into ./nginx/certs to use real certs —
# they take precedence and this script leaves them untouched.
set -e

CERT_DIR=/etc/nginx/certs

if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
  echo "[cert] using existing certificate in $CERT_DIR"
  exit 0
fi

echo "[cert] no server.crt/server.key in $CERT_DIR — generating a self-signed dev cert"
mkdir -p "$CERT_DIR"
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
echo "[cert] self-signed dev cert written to $CERT_DIR (browsers will warn — expected)"
