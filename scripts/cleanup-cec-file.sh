#!/bin/bash

# Script de nettoyage du fichier de communication CEC

echo "🧹 === NETTOYAGE FICHIER COMMUNICATION CEC ==="
echo ""

# Vérifier que nous sommes root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Erreur: Ce script doit être exécuté en tant que root"
    echo "   sudo ./scripts/cleanup-cec-file.sh"
    exit 1
fi

echo "1️⃣ Vérification du fichier de communication:"

if [ -f "/tmp/cec-to-homebridge.json" ]; then
    echo "   ✅ Fichier existe: /tmp/cec-to-homebridge.json"
    
    # Vérifier le contenu
    if [ -s "/tmp/cec-to-homebridge.json" ]; then
        echo "   📄 Contenu actuel:"
        cat /tmp/cec-to-homebridge.json
        echo ""
        
        # Tester si c'est du JSON valide
        if echo "$(cat /tmp/cec-to-homebridge.json)" | jq . >/dev/null 2>&1; then
            echo "   ✅ JSON valide"
        else
            echo "   ❌ JSON invalide - nettoyage nécessaire"
            echo "" > /tmp/cec-to-homebridge.json
            chmod 666 /tmp/cec-to-homebridge.json
            echo "   🧹 Fichier vidé et permissions corrigées"
        fi
    else
        echo "   ℹ️  Fichier vide (normal)"
    fi
    
    echo "   📊 Permissions actuelles:"
    ls -la /tmp/cec-to-homebridge.json
else
    echo "   ℹ️  Fichier n'existe pas (normal si aucune commande récente)"
fi

echo ""
echo "2️⃣ Nettoyage des fichiers temporaires:"

# Nettoyer les fichiers temporaires
rm -f /tmp/cec-to-homebridge.json.tmp
echo "   ✅ Fichiers temporaires supprimés"

echo ""
echo "3️⃣ Test de création d'un fichier valide:"

# Créer un fichier de test valide
echo '{"action":"test","value":"cleanup","timestamp":'$(date +%s)'}' > /tmp/cec-to-homebridge.json
chmod 666 /tmp/cec-to-homebridge.json

echo "   ✅ Fichier de test créé"
echo "   📄 Contenu:"
cat /tmp/cec-to-homebridge.json
echo ""

# Vérifier que c'est du JSON valide
if echo "$(cat /tmp/cec-to-homebridge.json)" | jq . >/dev/null 2>&1; then
    echo "   ✅ JSON de test valide"
else
    echo "   ❌ Erreur: JSON de test invalide"
fi

echo ""
echo "4️⃣ Vérification des services:"

# Vérifier le service CEC
if systemctl is-active --quiet cec-panasonic-ampli.service; then
    echo "   ✅ Service CEC actif"
else
    echo "   ❌ Service CEC inactif"
    echo "   📊 Statut: $(systemctl is-active cec-panasonic-ampli.service)"
fi

# Vérifier Homebridge
if pgrep -f homebridge >/dev/null; then
    echo "   ✅ Homebridge en cours d'exécution"
else
    echo "   ❌ Homebridge non trouvé"
fi

echo ""
echo "🎯 === NETTOYAGE TERMINÉ ==="
echo ""
echo "📋 Vérifications recommandées:"
echo "   1. Surveillez les logs Homebridge: sudo journalctl -u homebridge -f"
echo "   2. Testez une commande CEC depuis l'Apple TV"
echo "   3. Vérifiez qu'il n'y a plus d'erreurs JSON"
echo ""
echo "🔧 Si le problème persiste:"
echo "   - Redémarrez le service CEC: sudo systemctl restart cec-panasonic-ampli.service"
echo "   - Redémarrez Homebridge: sudo systemctl restart homebridge"
