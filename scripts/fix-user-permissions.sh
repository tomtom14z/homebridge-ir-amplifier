#!/bin/bash

# Script de correction des permissions utilisateur pour la communication CEC ↔ Homebridge

echo "👤 === CORRECTION PERMISSIONS UTILISATEUR CEC ==="
echo ""

# Vérifier que nous sommes root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Erreur: Ce script doit être exécuté en tant que root"
    echo "   sudo ./scripts/fix-user-permissions.sh"
    exit 1
fi

echo "1️⃣ Détection de l'utilisateur Homebridge:"

# Trouver l'utilisateur Homebridge
HOMEBRIDGE_USER=""
for user in homebridge pi homebridge-user; do
    if id "$user" &>/dev/null; then
        HOMEBRIDGE_USER="$user"
        echo "   ✅ Utilisateur Homebridge trouvé: $user"
        break
    fi
done

if [ -z "$HOMEBRIDGE_USER" ]; then
    echo "   ❌ Aucun utilisateur Homebridge trouvé"
    echo "   📊 Utilisateurs disponibles:"
    cut -d: -f1 /etc/passwd | grep -E "(homebridge|pi)" || echo "   Aucun utilisateur standard trouvé"
    exit 1
fi

echo ""
echo "2️⃣ Vérification du processus Homebridge:"

# Vérifier sous quel utilisateur Homebridge s'exécute
if pgrep -f homebridge >/dev/null; then
    HOMEBRIDGE_PID=$(pgrep -f homebridge)
    ACTUAL_USER=$(ps -o user= -p $HOMEBRIDGE_PID)
    echo "   ✅ Homebridge en cours d'exécution"
    echo "   📊 PID: $HOMEBRIDGE_PID"
    echo "   📊 Utilisateur actuel: $ACTUAL_USER"
    
    if [ "$ACTUAL_USER" != "$HOMEBRIDGE_USER" ]; then
        echo "   ⚠️  Utilisateur différent détecté: $ACTUAL_USER vs $HOMEBRIDGE_USER"
        HOMEBRIDGE_USER="$ACTUAL_USER"
    fi
else
    echo "   ❌ Homebridge non trouvé"
    echo "   📊 Utilisation de l'utilisateur détecté: $HOMEBRIDGE_USER"
fi

echo ""
echo "3️⃣ Correction des permissions du fichier de communication:"

# Créer le fichier avec le bon propriétaire
echo '{"action":"test","value":"permissions","timestamp":'$(date +%s)'}' > /tmp/cec-to-homebridge.json
chown "$HOMEBRIDGE_USER:$HOMEBRIDGE_USER" /tmp/cec-to-homebridge.json
chmod 666 /tmp/cec-to-homebridge.json

echo "   ✅ Fichier créé avec le bon propriétaire: $HOMEBRIDGE_USER"
echo "   📊 Permissions actuelles:"
ls -la /tmp/cec-to-homebridge.json

echo ""
echo "4️⃣ Test de communication:"

echo "   ⏳ Attente 3 secondes pour voir si Homebridge lit le fichier..."
sleep 3

if [ -f "/tmp/cec-to-homebridge.json" ]; then
    if [ -s "/tmp/cec-to-homebridge.json" ]; then
        echo "   ❌ Fichier toujours présent avec contenu - problème de communication"
        echo "   📄 Contenu restant:"
        cat /tmp/cec-to-homebridge.json
    else
        echo "   ✅ Fichier vidé - communication fonctionne !"
    fi
else
    echo "   ✅ Fichier supprimé - communication fonctionne !"
fi

echo ""
echo "5️⃣ Redémarrage du service CEC:"

# Redémarrer le service CEC pour appliquer les changements
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
echo "🎯 === CORRECTION TERMINÉE ==="
echo ""
echo "📋 Résumé:"
echo "   👤 Utilisateur Homebridge: $HOMEBRIDGE_USER"
echo "   📁 Fichier de communication: /tmp/cec-to-homebridge.json"
echo "   🔧 Propriétaire: $HOMEBRIDGE_USER:$HOMEBRIDGE_USER"
echo "   📊 Permissions: 666"
echo ""
echo "📋 Vérifications recommandées:"
echo "   1. Testez une commande CEC depuis l'Apple TV"
echo "   2. Surveillez les logs Homebridge: sudo journalctl -u homebridge -f"
echo "   3. Vérifiez les logs CEC: sudo journalctl -u cec-panasonic-ampli.service -f"
echo ""
echo "🔧 Si le problème persiste:"
echo "   - Redémarrez Homebridge: sudo systemctl restart homebridge"
echo "   - Vérifiez la configuration du plugin"
