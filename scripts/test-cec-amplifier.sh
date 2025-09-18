#!/bin/bash

# Script de test pour le service CEC Amplifier v2

echo "=== Test du service CEC Amplifier v2 ==="

# Vérifier que le service est actif
if systemctl is-active --quiet cec-amplifier-v2.service; then
    echo "✅ Service CEC Amplifier v2 est actif"
else
    echo "❌ Service CEC Amplifier v2 n'est pas actif"
    echo "Démarrez-le avec: sudo systemctl start cec-amplifier-v2.service"
    exit 1
fi

echo ""
echo "=== Test du scan CEC ==="

# Tester le scan CEC
echo "Exécution du scan CEC..."
timeout 10 cec-client -s -d 1 | grep -E "(device #|Audio System|AMPLi)" || echo "Aucun device Audio System trouvé"

echo ""
echo "=== Test des commandes CEC ==="

# Tester les commandes CEC
echo "Test de la commande Power ON..."
echo "tx 04:82:10:00" | cec-client -s -d 1

sleep 2

echo "Test de la commande Power OFF..."
echo "tx 04:36:00" | cec-client -s -d 1

echo ""
echo "=== Vérification des logs ==="

# Vérifier les logs du service
echo "Dernières entrées du log du service:"
tail -5 /var/log/cec-amplifier.log

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
echo "  sudo journalctl -u cec-amplifier-v2.service -f"
echo ""
echo "Pour tester manuellement:"
echo "  echo 'tx 04:82:10:00' | cec-client -s -d 1  # Power ON"
echo "  echo 'tx 04:36:00' | cec-client -s -d 1     # Power OFF"
