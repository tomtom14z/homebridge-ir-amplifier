#!/bin/bash

# Script de correction des permissions pour la communication CEC ↔ Homebridge

echo "🔧 === CORRECTION DES PERMISSIONS CEC ==="
echo ""

# Vérifier que nous sommes root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Erreur: Ce script doit être exécuté en tant que root"
    echo "   sudo ./scripts/fix-cec-permissions.sh"
    exit 1
fi

echo "1️⃣ Correction des permissions du fichier de communication:"

# Créer le fichier avec les bonnes permissions s'il n'existe pas
if [ ! -f "/tmp/cec-to-homebridge.json" ]; then
    echo '{"action":"test","value":"permissions","timestamp":'$(date +%s)'}' > /tmp/cec-to-homebridge.json
    echo "   ✅ Fichier de test créé"
fi

# Définir les permissions correctes
chmod 666 /tmp/cec-to-homebridge.json
echo "   ✅ Permissions définies: 666 (lecture/écriture pour tous)"

# Vérifier les permissions
echo "   📊 Permissions actuelles:"
ls -la /tmp/cec-to-homebridge.json

echo ""
echo "2️⃣ Redémarrage du service CEC pour appliquer les changements:"

# Redémarrer le service CEC
systemctl restart cec-panasonic-ampli.service
echo "   ✅ Service CEC redémarré"

# Attendre un peu
sleep 2

# Vérifier le statut
if systemctl is-active --quiet cec-panasonic-ampli.service; then
    echo "   ✅ Service CEC actif"
else
    echo "   ❌ Service CEC inactif"
    echo "   📊 Statut: $(systemctl is-active cec-panasonic-ampli.service)"
fi

echo ""
echo "3️⃣ Test de communication:"

# Créer un fichier de test
echo '{"action":"volume","value":"up","timestamp":'$(date +%s)'}' > /tmp/cec-to-homebridge.json
chmod 666 /tmp/cec-to-homebridge.json

echo "   ✅ Fichier de test créé avec permissions 666"
echo "   📄 Contenu:"
cat /tmp/cec-to-homebridge.json
echo ""

echo "   ⏳ Attente 5 secondes pour voir si Homebridge lit le fichier..."
sleep 5

if [ -f "/tmp/cec-to-homebridge.json" ]; then
    echo "   ⚠️  Fichier toujours présent - vérifiez les logs Homebridge"
    echo "   📊 Permissions actuelles:"
    ls -la /tmp/cec-to-homebridge.json
else
    echo "   ✅ Fichier supprimé - communication fonctionne !"
fi

echo ""
echo "🎯 === CORRECTION TERMINÉE ==="
echo ""
echo "📋 Vérifications recommandées:"
echo "   1. Vérifiez les logs Homebridge: sudo journalctl -u homebridge -f"
echo "   2. Testez une commande CEC depuis l'Apple TV"
echo "   3. Surveillez les logs CEC: sudo journalctl -u cec-panasonic-ampli.service -f"
echo ""
echo "🔧 Si le problème persiste:"
echo "   - Vérifiez que Homebridge s'exécute avec les bonnes permissions"
echo "   - Redémarrez Homebridge: sudo systemctl restart homebridge"
