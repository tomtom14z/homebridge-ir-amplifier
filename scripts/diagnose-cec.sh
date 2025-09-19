#!/bin/bash

# Script de diagnostic CEC pour identifier les conflits

echo "=== Diagnostic CEC ==="

# Vérifier les processus CEC
echo "1. Processus CEC actifs:"
ps aux | grep -E "(cec|CEC)" | grep -v grep || echo "Aucun processus CEC trouvé"

echo ""
echo "2. Processus Homebridge:"
ps aux | grep homebridge | grep -v grep || echo "Homebridge non trouvé"

echo ""
echo "3. Utilisation du device CEC:"
if command -v lsof &> /dev/null; then
    lsof /dev/cec0 2>/dev/null || echo "Device CEC /dev/cec0 non utilisé"
else
    echo "lsof non disponible, vérification manuelle:"
    ls -la /dev/cec*
fi

echo ""
echo "4. Services systemd CEC:"
systemctl list-units --type=service | grep -i cec || echo "Aucun service CEC systemd"

echo ""
echo "5. Test de base du device CEC:"
if [ -e "/dev/cec0" ]; then
    echo "Device CEC /dev/cec0 existe"
    ls -la /dev/cec0
else
    echo "ERREUR: Device CEC /dev/cec0 non trouvé"
fi

echo ""
echo "6. Test cec-client simple:"
timeout 5 cec-client -s -d 1 2>&1 | head -10 || echo "cec-client ne répond pas"

echo ""
echo "7. Vérifier les permissions:"
groups $(whoami) | grep -E "(video|cec)" && echo "Utilisateur dans les bons groupes" || echo "ATTENTION: Utilisateur pas dans les groupes video/cec"

echo ""
echo "=== Diagnostic terminé ==="
