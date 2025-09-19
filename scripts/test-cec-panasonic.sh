#!/bin/bash

# Script de test pour le service CEC Panasonic Ampli

echo "=== Test du service CEC Panasonic Ampli ==="

# Vérifier que le service est actif
if systemctl is-active --quiet cec-panasonic-ampli.service; then
    echo "✅ Service CEC Panasonic Ampli est actif"
else
    echo "❌ Service CEC Panasonic Ampli n'est pas actif"
    echo "Démarrez-le avec: sudo systemctl start cec-panasonic-ampli.service"
    exit 1
fi

echo ""
echo "=== Test de la configuration CEC ==="

# Tester la configuration CEC
echo "Configuration CEC actuelle:"
sudo cec-ctl -d /dev/cec0 -S

echo ""
echo "=== Test des commandes CEC ==="

# Tester les commandes CEC
echo "Test de la commande Volume UP..."
echo "tx 04:44:41" | sudo cec-ctl -d /dev/cec0

sleep 2

echo "Test de la commande Volume DOWN..."
echo "tx 04:44:42" | sudo cec-ctl -d /dev/cec0

sleep 2

echo "Test de la commande Mute..."
echo "tx 04:44:43" | sudo cec-ctl -d /dev/cec0

echo ""
echo "=== Vérification des logs ==="

# Vérifier les logs du service
echo "Dernières entrées du log du service:"
tail -10 /var/log/cec-panasonic-ampli.log

echo ""
echo "=== Vérification de la communication avec Homebridge ==="

# Vérifier le fichier de communication
if [ -f "/tmp/cec-to-homebridge.json" ]; then
    echo "✅ Fichier de communication trouvé:"
    cat /tmp/cec-to-homebridge.json
else
    echo "ℹ️  Aucun fichier de communication actuel (normal si pas de commande récente)"
fi

echo ""
echo "=== Test terminé ==="
echo ""
echo "Pour surveiller les logs en temps réel:"
echo "  sudo journalctl -u cec-panasonic-ampli.service -f"
echo ""
echo "Pour tester manuellement:"
echo "  echo 'tx 04:44:41' | sudo cec-ctl -d /dev/cec0  # Volume UP"
echo "  echo 'tx 04:44:42' | sudo cec-ctl -d /dev/cec0  # Volume DOWN"
echo "  echo 'tx 04:44:43' | sudo cec-ctl -d /dev/cec0  # Mute"
echo ""
echo "Configuration CEC:"
echo "  sudo cec-ctl -d /dev/cec0 -S"
