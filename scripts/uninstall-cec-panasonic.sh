#!/bin/bash

# Script de désinstallation du service CEC Panasonic Ampli
# Pour Homebridge IR Amplifier Plugin

set -e

echo "=== Désinstallation du service CEC Panasonic Ampli ==="

# Vérifier que nous sommes root
if [ "$EUID" -ne 0 ]; then
    echo "ERREUR: Ce script doit être exécuté en tant que root"
    echo "Utilisez: sudo $0"
    exit 1
fi

# Arrêter le service
echo "Arrêt du service CEC Panasonic Ampli..."
systemctl stop cec-panasonic-ampli.service 2>/dev/null || echo "Service non actif"

# Désactiver le service
echo "Désactivation du service..."
systemctl disable cec-panasonic-ampli.service 2>/dev/null || echo "Service non activé"

# Supprimer les fichiers
echo "Suppression des fichiers..."
rm -f /usr/local/bin/cec-panasonic-ampli.sh
rm -f /etc/systemd/system/cec-panasonic-ampli.service

# Recharger systemd
echo "Rechargement de systemd..."
systemctl daemon-reload

# Nettoyer les logs (optionnel)
read -p "Supprimer les logs CEC? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -f /var/log/cec-panasonic-ampli.log
    echo "Logs supprimés"
fi

# Nettoyer le fichier de communication
rm -f /tmp/cec-to-homebridge.json

echo ""
echo "=== Désinstallation terminée ==="
echo "Le service CEC Panasonic Ampli a été supprimé"
