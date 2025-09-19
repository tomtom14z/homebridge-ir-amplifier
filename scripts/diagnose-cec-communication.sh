#!/bin/bash

# Script de diagnostic de la communication CEC ↔ Homebridge

echo "🔍 === DIAGNOSTIC COMMUNICATION CEC ↔ HOMEBRIDGE ==="
echo ""

# 1. Vérifier le service CEC
echo "1️⃣ Vérification du service CEC Panasonic Ampli:"
if systemctl is-active --quiet cec-panasonic-ampli.service; then
    echo "   ✅ Service CEC actif"
    echo "   📊 Statut: $(systemctl is-active cec-panasonic-ampli.service)"
else
    echo "   ❌ Service CEC inactif"
    echo "   📊 Statut: $(systemctl is-active cec-panasonic-ampli.service)"
fi
echo ""

# 2. Vérifier les logs CEC récents
echo "2️⃣ Logs CEC récents (dernières 10 lignes):"
sudo journalctl -u cec-panasonic-ampli.service -n 10 --no-pager
echo ""

# 3. Vérifier le fichier de communication
echo "3️⃣ Fichier de communication CEC:"
if [ -f "/tmp/cec-to-homebridge.json" ]; then
    echo "   ✅ Fichier existe: /tmp/cec-to-homebridge.json"
    echo "   📄 Contenu:"
    cat /tmp/cec-to-homebridge.json | jq . 2>/dev/null || cat /tmp/cec-to-homebridge.json
    echo ""
else
    echo "   ℹ️  Fichier n'existe pas (normal si aucune commande récente)"
fi
echo ""

# 4. Vérifier les logs Homebridge
echo "4️⃣ Logs Homebridge récents (recherche CEC):"
echo "   Recherche des messages CEC dans les logs Homebridge..."
if command -v journalctl >/dev/null 2>&1; then
    # Si Homebridge est un service systemd
    sudo journalctl -u homebridge -n 50 --no-pager | grep -i cec || echo "   Aucun message CEC trouvé dans les logs Homebridge"
else
    echo "   journalctl non disponible - vérifiez manuellement les logs Homebridge"
fi
echo ""

# 5. Test de communication
echo "5️⃣ Test de communication:"
echo "   Création d'un fichier de test..."
echo '{"action":"volume","value":"up","timestamp":'$(date +%s)'}' > /tmp/cec-to-homebridge.json
echo "   ✅ Fichier de test créé"
echo "   📄 Contenu:"
cat /tmp/cec-to-homebridge.json
echo ""
echo "   ⏳ Attente 5 secondes pour voir si Homebridge lit le fichier..."
sleep 5

if [ -f "/tmp/cec-to-homebridge.json" ]; then
    echo "   ❌ Fichier toujours présent - Homebridge ne lit pas le fichier"
    echo "   🔧 Vérifiez que le plugin est bien chargé et actif"
else
    echo "   ✅ Fichier supprimé - Homebridge a lu le fichier"
fi
echo ""

# 6. Vérifier les processus
echo "6️⃣ Processus Homebridge:"
if pgrep -f homebridge >/dev/null; then
    echo "   ✅ Homebridge en cours d'exécution"
    echo "   📊 PID: $(pgrep -f homebridge)"
else
    echo "   ❌ Homebridge non trouvé"
fi
echo ""

# 7. Vérifier la configuration du plugin
echo "7️⃣ Configuration du plugin:"
PLUGIN_DIR="/var/lib/homebridge/node_modules/homebridge-ir-amplifier"
if [ -d "$PLUGIN_DIR" ]; then
    echo "   ✅ Plugin installé: $PLUGIN_DIR"
    echo "   📊 Version: $(cat $PLUGIN_DIR/package.json | grep version | cut -d'"' -f4)"
else
    echo "   ❌ Plugin non trouvé dans $PLUGIN_DIR"
fi
echo ""

# 8. Vérifier les permissions
echo "8️⃣ Permissions du fichier de communication:"
if [ -f "/tmp/cec-to-homebridge.json" ]; then
    ls -la /tmp/cec-to-homebridge.json
else
    echo "   Fichier n'existe pas"
fi
echo ""

echo "🎯 === RÉSUMÉ DU DIAGNOSTIC ==="
echo ""
echo "📋 Actions recommandées:"
echo "   1. Vérifiez les logs Homebridge: sudo journalctl -u homebridge -f"
echo "   2. Redémarrez Homebridge: sudo systemctl restart homebridge"
echo "   3. Testez une commande CEC depuis l'Apple TV"
echo "   4. Vérifiez la configuration du plugin dans config.json"
echo ""
echo "🔧 Commandes utiles:"
echo "   sudo journalctl -u cec-panasonic-ampli.service -f"
echo "   sudo journalctl -u homebridge -f | grep -i cec"
echo "   tail -f /var/log/cec-panasonic-ampli.log"
