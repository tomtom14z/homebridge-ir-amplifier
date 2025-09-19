#!/bin/bash

# Script de nettoyage CEC pour résoudre les conflits

echo "=== Nettoyage CEC ==="

# Arrêter tous les services CEC
echo "1. Arrêt des services CEC..."
systemctl stop cec-amplifier.service 2>/dev/null || echo "Service cec-amplifier non actif"
systemctl stop cec-amplifier-v2.service 2>/dev/null || echo "Service cec-amplifier-v2 non actif"

# Tuer tous les processus cec-client
echo "2. Arrêt des processus cec-client..."
pkill -f cec-client || echo "Aucun processus cec-client trouvé"

# Attendre que les processus se terminent
sleep 3

# Vérifier que le device CEC est libre
echo "3. Vérification du device CEC..."
if [ -e "/dev/cec0" ]; then
    echo "Device CEC /dev/cec0 existe"
    if lsof /dev/cec0 2>/dev/null; then
        echo "ATTENTION: Device CEC encore utilisé"
        echo "Processus utilisant CEC:"
        lsof /dev/cec0
    else
        echo "✅ Device CEC libre"
    fi
else
    echo "ERREUR: Device CEC /dev/cec0 non trouvé"
fi

# Nettoyer les fichiers temporaires
echo "4. Nettoyage des fichiers temporaires..."
rm -f /tmp/cec-to-homebridge.json

# Redémarrer le service CEC simple
echo "5. Démarrage du service CEC simple..."
if [ -f "/usr/local/bin/cec-amplifier-simple.sh" ]; then
    systemctl start cec-amplifier-simple.service 2>/dev/null || echo "Service simple non configuré"
else
    echo "Script simple non installé"
fi

echo ""
echo "=== Nettoyage terminé ==="
echo ""
echo "Pour tester:"
echo "  sudo ./scripts/diagnose-cec.sh"
echo "  sudo journalctl -u cec-amplifier-simple.service -f"
