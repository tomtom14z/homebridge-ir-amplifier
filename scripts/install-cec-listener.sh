#!/bin/bash

# Script d'installation du service CEC Listener
# Pour Homebridge IR Amplifier Plugin

set -e

echo "=== Installation du service CEC Listener ==="

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

# Désactiver tous les services CEC
systemctl disable cec-amplifier.service 2>/dev/null || echo "Service cec-amplifier non activé"
systemctl disable cec-amplifier-v2.service 2>/dev/null || echo "Service cec-amplifier-v2 non activé"
systemctl disable cec-amplifier-working.service 2>/dev/null || echo "Service cec-amplifier-working non activé"

# Tuer tous les processus cec-client
echo "Arrêt des processus cec-client..."
pkill -f cec-client || echo "Aucun processus cec-client trouvé"

# Attendre que les processus se terminent
sleep 5

# Vérifier que cec-client est installé
if ! command -v cec-client &> /dev/null; then
    echo "ERREUR: cec-client n'est pas installé"
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
touch /var/log/cec-listener.log
chmod 644 /var/log/cec-listener.log

# Copier le script listener
echo "Copie du script CEC Listener..."
cp scripts/cec-listener.sh /usr/local/bin/cec-listener.sh
chmod +x /usr/local/bin/cec-listener.sh

# Copier le service systemd
echo "Installation du service systemd..."
cp scripts/cec-listener.service /etc/systemd/system/cec-listener.service

# Recharger systemd
echo "Rechargement de systemd..."
systemctl daemon-reload

# Activer le service
echo "Activation du service..."
systemctl enable cec-listener.service

echo ""
echo "=== Installation terminée ==="
echo ""
echo "Pour démarrer le service:"
echo "  sudo systemctl start cec-listener.service"
echo ""
echo "Pour voir les logs:"
echo "  sudo journalctl -u cec-listener.service -f"
echo ""
echo "Pour voir les logs du fichier:"
echo "  tail -f /var/log/cec-listener.log"
echo ""
echo "Le service CEC Listener écoute maintenant les commandes CEC"
echo "sans essayer de se présenter comme un device CEC."
echo ""
echo "Test du service:"
echo "  sudo systemctl status cec-listener.service"
