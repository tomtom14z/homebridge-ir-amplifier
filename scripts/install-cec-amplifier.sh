#!/bin/bash

# Script d'installation du service CEC Amplifier
# Pour Homebridge IR Amplifier Plugin

set -e

echo "=== Installation du service CEC Amplifier ==="

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

# Créer le répertoire de logs
mkdir -p /var/log
touch /var/log/cec-amplifier.log
chmod 644 /var/log/cec-amplifier.log

# Copier le script
echo "Copie du script CEC Amplifier..."
cp scripts/cec-amplifier.sh /usr/local/bin/cec-amplifier.sh
chmod +x /usr/local/bin/cec-amplifier.sh

# Copier le service systemd
echo "Installation du service systemd..."
cp scripts/cec-amplifier.service /etc/systemd/system/cec-amplifier.service

# Recharger systemd
echo "Rechargement de systemd..."
systemctl daemon-reload

# Activer le service
echo "Activation du service..."
systemctl enable cec-amplifier.service

echo ""
echo "=== Installation terminée ==="
echo ""
echo "Pour démarrer le service:"
echo "  sudo systemctl start cec-amplifier.service"
echo ""
echo "Pour voir les logs:"
echo "  sudo journalctl -u cec-amplifier.service -f"
echo ""
echo "Pour voir les logs du fichier:"
echo "  tail -f /var/log/cec-amplifier.log"
echo ""
echo "Le Raspberry Pi se présentera maintenant comme un amplificateur audio CEC"
echo "et apparaîtra dans les scans CEC des autres appareils."
