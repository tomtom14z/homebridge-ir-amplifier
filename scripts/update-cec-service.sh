#!/bin/bash

# Script de mise à jour du service CEC Panasonic Ampli
# À exécuter après une mise à jour du plugin

echo "🔄 Mise à jour du service CEC Panasonic Ampli..."

# Vérifier que nous sommes dans le bon répertoire
if [ ! -f "scripts/install-cec-panasonic.sh" ]; then
    echo "❌ Erreur: Ce script doit être exécuté depuis le répertoire du plugin"
    echo "   cd /var/lib/homebridge/node_modules/homebridge-ir-amplifier"
    echo "   sudo ./scripts/update-cec-service.sh"
    exit 1
fi

# Vérifier que nous sommes root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Erreur: Ce script doit être exécuté en tant que root"
    echo "   sudo ./scripts/update-cec-service.sh"
    exit 1
fi

echo "🔧 Arrêt du service CEC existant..."
systemctl stop cec-panasonic-ampli.service 2>/dev/null || echo "ℹ️  Aucun service existant"

echo "🔧 Réinstallation du service CEC..."
./scripts/install-cec-panasonic.sh

echo "✅ Mise à jour terminée!"
echo ""
echo "📋 Vérification:"
echo "   sudo systemctl status cec-panasonic-ampli.service"
echo "   sudo journalctl -u cec-panasonic-ampli.service -f"
