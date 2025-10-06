#!/bin/bash

# Script de mise à jour du service CEC pour homebridge-ir-amplifier sur Raspberry Pi
# Usage: bash /usr/local/lib/node_modules/homebridge-ir-amplifier/scripts/update-cec-service.sh
# Ou: NPM_GLOBAL_PATH=$(npm root -g) && bash "$NPM_GLOBAL_PATH/homebridge-ir-amplifier/scripts/update-cec-service.sh"

set -e

echo "🔄 Mise à jour du plugin homebridge-ir-amplifier et du service CEC..."
echo ""

# 1. Mettre à jour le plugin npm
echo "📦 Mise à jour du plugin npm..."
sudo npm update -g homebridge-ir-amplifier
echo "✅ Plugin npm mis à jour"
echo ""

# 2. Arrêter le service CEC
echo "🛑 Arrêt du service CEC..."
sudo systemctl stop cec-panasonic-ampli 2>/dev/null || true
echo "✅ Service CEC arrêté"
echo ""

# 3. Mettre à jour le script CEC
echo "📝 Mise à jour du script CEC..."
SCRIPT_PATH="/usr/local/bin/cec-panasonic-ampli.sh"
NPM_GLOBAL_PATH=$(npm root -g)
PLUGIN_PATH="$NPM_GLOBAL_PATH/homebridge-ir-amplifier"

if [ -f "$PLUGIN_PATH/scripts/cec-panasonic-ampli.sh" ]; then
    sudo cp "$PLUGIN_PATH/scripts/cec-panasonic-ampli.sh" "$SCRIPT_PATH"
    sudo chmod +x "$SCRIPT_PATH"
    sudo chown root:root "$SCRIPT_PATH"
    echo "✅ Script CEC mis à jour"
else
    echo "⚠️  Script CEC non trouvé dans le plugin, conservation de l'ancien"
fi
echo ""

# 4. Redémarrer le service CEC
echo "🔄 Redémarrage du service CEC..."
sudo systemctl restart cec-panasonic-ampli
echo "✅ Service CEC redémarré"
echo ""

# 5. Redémarrer Homebridge
echo "🔄 Redémarrage de Homebridge..."
sudo systemctl restart homebridge
echo "✅ Homebridge redémarré"
echo ""

# 6. Vérifier les statuts
echo "📊 Vérification des statuts..."
echo ""
echo "Service CEC:"
sudo systemctl status cec-panasonic-ampli --no-pager | head -5
echo ""
echo "Homebridge:"
sudo systemctl status homebridge --no-pager | head -5
echo ""

echo "✅ Mise à jour terminée !"
echo ""
echo "📋 Pour voir les logs CEC:"
echo "   sudo journalctl -u cec-panasonic-ampli -f"
echo ""
echo "📋 Pour voir les logs Homebridge:"
echo "   sudo journalctl -u homebridge -f"

