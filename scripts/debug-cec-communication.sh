#!/bin/bash

# Script de diagnostic de la communication CEC ↔ Homebridge

echo "🔍 === DIAGNOSTIC COMMUNICATION CEC ↔ HOMEBRIDGE ==="
echo ""

# 1. Vérifier le service CEC
echo "1️⃣ Service CEC Panasonic Ampli:"
if systemctl is-active --quiet cec-panasonic-ampli.service; then
    echo "   ✅ Service CEC actif"
    echo "   📊 Statut: $(systemctl is-active cec-panasonic-ampli.service)"
else
    echo "   ❌ Service CEC inactif"
    echo "   📊 Statut: $(systemctl is-active cec-panasonic-ampli.service)"
fi
echo ""

# 2. Vérifier les logs CEC récents
echo "2️⃣ Logs CEC récents (dernières 5 lignes):"
sudo journalctl -u cec-panasonic-ampli.service -n 5 --no-pager
echo ""

# 3. Vérifier le fichier de communication
echo "3️⃣ Fichier de communication CEC:"
if [ -f "/tmp/cec-to-homebridge.json" ]; then
    echo "   ✅ Fichier existe: /tmp/cec-to-homebridge.json"
    echo "   📊 Taille: $(stat -c%s /tmp/cec-to-homebridge.json) bytes"
    echo "   📄 Contenu:"
    if [ -s "/tmp/cec-to-homebridge.json" ]; then
        cat /tmp/cec-to-homebridge.json | jq . 2>/dev/null || cat /tmp/cec-to-homebridge.json
    else
        echo "   (fichier vide)"
    fi
    echo ""
    echo "   📊 Permissions:"
    ls -la /tmp/cec-to-homebridge.json
else
    echo "   ℹ️  Fichier n'existe pas (normal si aucune commande récente)"
fi
echo ""

# 4. Vérifier les processus
echo "4️⃣ Processus:"
if pgrep -f homebridge >/dev/null; then
    echo "   ✅ Homebridge en cours d'exécution"
    echo "   📊 PID: $(pgrep -f homebridge)"
else
    echo "   ❌ Homebridge non trouvé"
fi

if pgrep -f cec-follower >/dev/null; then
    echo "   ✅ cec-follower en cours d'exécution"
    echo "   📊 PID: $(pgrep -f cec-follower)"
else
    echo "   ❌ cec-follower non trouvé"
fi
echo ""

# 5. Test de communication manuel
echo "5️⃣ Test de communication manuel:"
echo "   Création d'un fichier de test..."
echo '{"action":"test","value":"manual","timestamp":'$(date +%s)'}' > /tmp/cec-to-homebridge.json
chmod 666 /tmp/cec-to-homebridge.json
echo "   ✅ Fichier de test créé"
echo "   📄 Contenu:"
cat /tmp/cec-to-homebridge.json
echo ""

echo "   ⏳ Attente 3 secondes pour voir si Homebridge lit le fichier..."
sleep 3

if [ -f "/tmp/cec-to-homebridge.json" ]; then
    if [ -s "/tmp/cec-to-homebridge.json" ]; then
        echo "   ❌ Fichier toujours présent avec contenu - Homebridge ne lit pas le fichier"
        echo "   📄 Contenu restant:"
        cat /tmp/cec-to-homebridge.json
    else
        echo "   ✅ Fichier vidé - Homebridge a lu le fichier"
    fi
else
    echo "   ✅ Fichier supprimé - Homebridge a lu le fichier"
fi
echo ""

# 6. Vérifier les logs Homebridge
echo "6️⃣ Logs Homebridge récents (recherche CEC):"
echo "   Recherche des messages CEC dans les logs Homebridge..."
if command -v journalctl >/dev/null 2>&1; then
    # Si Homebridge est un service systemd
    sudo journalctl -u homebridge -n 20 --no-pager | grep -i cec || echo "   Aucun message CEC trouvé dans les logs Homebridge"
else
    echo "   journalctl non disponible - vérifiez manuellement les logs Homebridge"
fi
echo ""

# 7. Vérifier la configuration du plugin
echo "7️⃣ Configuration du plugin:"
PLUGIN_DIR="/var/lib/homebridge/node_modules/homebridge-ir-amplifier"
if [ -d "$PLUGIN_DIR" ]; then
    echo "   ✅ Plugin installé: $PLUGIN_DIR"
    echo "   📊 Version: $(cat $PLUGIN_DIR/package.json | grep version | cut -d'"' -f4)"
    
    # Vérifier que le fichier de surveillance existe
    if [ -f "$PLUGIN_DIR/src/platformAccessory.ts" ]; then
        if grep -q "startExternalCECWatcher" "$PLUGIN_DIR/src/platformAccessory.ts"; then
            echo "   ✅ Code de surveillance CEC présent"
        else
            echo "   ❌ Code de surveillance CEC manquant"
        fi
    fi
else
    echo "   ❌ Plugin non trouvé dans $PLUGIN_DIR"
fi
echo ""

# 8. Vérifier les permissions
echo "8️⃣ Permissions et propriétaire:"
if [ -f "/tmp/cec-to-homebridge.json" ]; then
    echo "   📊 Fichier de communication:"
    ls -la /tmp/cec-to-homebridge.json
    echo "   📊 Propriétaire: $(stat -c '%U:%G' /tmp/cec-to-homebridge.json)"
fi

# Vérifier le propriétaire du processus Homebridge
if pgrep -f homebridge >/dev/null; then
    HOMEBRIDGE_PID=$(pgrep -f homebridge)
    echo "   📊 Homebridge propriétaire: $(ps -o user= -p $HOMEBRIDGE_PID)"
fi
echo ""

echo "🎯 === RÉSUMÉ DU DIAGNOSTIC ==="
echo ""
echo "📋 Actions recommandées selon les résultats:"
echo ""
echo "🔴 Si le service CEC est inactif:"
echo "   sudo systemctl start cec-panasonic-ampli.service"
echo ""
echo "🔴 Si Homebridge ne lit pas le fichier:"
echo "   sudo systemctl restart homebridge"
echo "   Vérifiez la configuration du plugin"
echo ""
echo "🔴 Si le fichier n'est pas créé:"
echo "   Vérifiez les logs du service CEC"
echo "   Testez une commande depuis l'Apple TV"
echo ""
echo "🔴 Si les permissions sont incorrectes:"
echo "   sudo ./scripts/fix-cec-permissions.sh"
echo ""
echo "🔧 Commandes utiles:"
echo "   sudo journalctl -u cec-panasonic-ampli.service -f"
echo "   sudo journalctl -u homebridge -f | grep -i cec"
echo "   tail -f /var/log/cec-panasonic-ampli.log"
