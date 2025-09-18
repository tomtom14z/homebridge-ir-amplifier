#!/bin/bash

# Script d'installation du service CEC Amplifier v2
# Pour Homebridge IR Amplifier Plugin

set -e

echo "=== Installation du service CEC Amplifier v2 ==="

# Vérifier que nous sommes root
if [ "$EUID" -ne 0 ]; then
    echo "ERREUR: Ce script doit être exécuté en tant que root"
    echo "Utilisez: sudo $0"
    exit 1
fi

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

# Arrêter l'ancien service s'il existe
if systemctl is-active --quiet cec-amplifier.service; then
    echo "Arrêt de l'ancien service CEC Amplifier..."
    systemctl stop cec-amplifier.service
    systemctl disable cec-amplifier.service
fi

# Créer le répertoire de logs
mkdir -p /var/log
touch /var/log/cec-amplifier.log
chmod 644 /var/log/cec-amplifier.log

# Copier le script v2
echo "Copie du script CEC Amplifier v2..."
cp scripts/cec-amplifier-v2.sh /usr/local/bin/cec-amplifier-v2.sh
chmod +x /usr/local/bin/cec-amplifier-v2.sh

# Copier le service systemd v2
echo "Installation du service systemd v2..."
cp scripts/cec-amplifier-v2.service /etc/systemd/system/cec-amplifier-v2.service

# Recharger systemd
echo "Rechargement de systemd..."
systemctl daemon-reload

# Activer le service v2
echo "Activation du service v2..."
systemctl enable cec-amplifier-v2.service

echo ""
echo "=== Installation terminée ==="
echo ""
echo "Pour démarrer le service:"
echo "  sudo systemctl start cec-amplifier-v2.service"
echo ""
echo "Pour voir les logs:"
echo "  sudo journalctl -u cec-amplifier-v2.service -f"
echo ""
echo "Pour voir les logs du fichier:"
echo "  tail -f /var/log/cec-amplifier.log"
echo ""
echo "Le Raspberry Pi se présentera maintenant comme un amplificateur audio CEC"
echo "avec le nom 'AMPLi' et apparaîtra dans les scans CEC des autres appareils."
echo ""
echo "Test du scan CEC:"
echo "  cec-client -s -d 1"
