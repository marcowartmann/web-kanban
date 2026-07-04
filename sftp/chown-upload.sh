#!/bin/sh
# atmoz/sftp runs executable scripts in /etc/sftp.d/ as root before sshd.
# The mounted upload volume is root-owned; make it writable by the sftp user.
chown "${SFTP_USER:-kanban}:users" "/home/${SFTP_USER:-kanban}/upload"
