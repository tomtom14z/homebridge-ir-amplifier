#!/bin/bash

# Script d'installation du service CEC Panasonic Ampli
# Pour Homebridge IR Amplifier Plugin
# Exécuté automatiquement lors de l'installation npm

set -e

echo "=== Installation du service CEC Panasonic Ampli ==="

# Vérifier que nous sommes root
if [ "$EUID" -ne 0 ]; then
    echo "ERREUR: Ce script doit être exécuté en tant que root"
    echo "Utilisez: sudo $0"
    exit 1
fi

# Arrêter tous les services CEC existants
echo "Arrêt des services CEC existants..."
systemctl stop cec-amplifier.service 2>/dev/null || echo "Service cec-amplifier non actif"
systemctl stop cec-amplifier-v2.service 2>/dev/null || echo "Service cec-amplifier-v2 non actif"
systemctl stop cec-amplifier-working.service 2>/dev/null || echo "Service cec-amplifier-working non actif"
systemctl stop cec-listener.service 2>/dev/null || echo "Service cec-listener non actif"
systemctl stop cec-amplifier-functional.service 2>/dev/null || echo "Service cec-amplifier-functional non actif"

# Désactiver tous les services CEC
systemctl disable cec-amplifier.service 2>/dev/null || echo "Service cec-amplifier non activé"
systemctl disable cec-amplifier-v2.service 2>/dev/null || echo "Service cec-amplifier-v2 non activé"
systemctl disable cec-amplifier-working.service 2>/dev/null || echo "Service cec-amplifier-working non activé"
systemctl disable cec-listener.service 2>/dev/null || echo "Service cec-listener non activé"
systemctl disable cec-amplifier-functional.service 2>/dev/null || echo "Service cec-amplifier-functional non activé"

# Tuer tous les processus cec-client
echo "Arrêt des processus cec-client..."
pkill -f cec-client || echo "Aucun processus cec-client trouvé"

# Attendre que les processus se terminent
sleep 10

# Vérifier que cec-ctl et cec-follower sont installés
if ! command -v cec-ctl &> /dev/null; then
    echo "ERREUR: cec-ctl n'est pas installé"
    echo "Installez-le avec: sudo apt-get install cec-utils"
    exit 1
fi

if ! command -v cec-follower &> /dev/null; then
    echo "ERREUR: cec-follower n'est pas installé"
    echo "Installez-le avec: sudo apt-get install cec-utils"
    exit 1
fi

# Vérifier que le device CEC existe
if [ ! -e "/dev/cec0" ]; then
    echo "ERREUR: Device CEC /dev/cec0 non trouvé"
    echo "Vérifiez que votre Raspberry Pi supporte CEC"
    exit 1
fi

# Créer le répertoire de logs
mkdir -p /var/log
touch /var/log/cec-panasonic-ampli.log
chmod 644 /var/log/cec-panasonic-ampli.log

# Copier le script Panasonic
echo "Copie du script CEC Panasonic Ampli..."
cp scripts/cec-panasonic-ampli.sh /usr/local/bin/cec-panasonic-ampli.sh
chmod +x /usr/local/bin/cec-panasonic-ampli.sh

# Copier le service systemd
echo "Installation du service systemd..."
cp scripts/cec-panasonic-ampli.service /etc/systemd/system/cec-panasonic-ampli.service

# Recharger systemd
echo "Rechargement de systemd..."
systemctl daemon-reload

# Activer le service
echo "Activation du service..."
systemctl enable cec-panasonic-ampli.service

echo ""
echo "=== Installation terminée ==="
echo ""
echo "Pour démarrer le service:"
echo "  sudo systemctl start cec-panasonic-ampli.service"
echo ""
echo "Pour voir les logs:"
echo "  sudo journalctl -u cec-panasonic-ampli.service -f"
echo ""
echo "Pour voir les logs du fichier:"
echo "  tail -f /var/log/cec-panasonic-ampli.log"
echo ""
echo "Le service CEC Panasonic Ampli utilise cec-follower et cec-ctl"
echo "pour une détection stable des commandes CEC."
echo ""
echo "Test du service:"
echo "  sudo systemctl status cec-panasonic-ampli.service"
echo ""
echo "Configuration CEC:"
echo "  sudo cec-ctl -d /dev/cec0 -S"
