#!/bin/bash

# Script CEC Amplifier fonctionnel - se présente comme un vrai device CEC
# Permet à l'Apple TV de contrôler l'amplificateur

LOG_FILE="/var/log/cec-amplifier.log"

# Fonction de logging
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Fonction pour envoyer des commandes à Homebridge
notify_homebridge() {
    local action="$1"
    local value="$2"
    
    echo "{\"action\":\"$action\",\"value\":\"$value\",\"timestamp\":$(date +%s)}" > /tmp/cec-to-homebridge.json
    log_message "Notified Homebridge: $action = $value"
}

# Vérifier que cec-client est disponible
if ! command -v cec-client &> /dev/null; then
    log_message "ERROR: cec-client not found"
    exit 1
fi

# Vérifier que le device CEC existe
if [ ! -e "/dev/cec0" ]; then
    log_message "ERROR: CEC device /dev/cec0 not found"
    exit 1
fi

log_message "Starting CEC Amplifier Functional service..."

# Attendre que le device CEC soit libre
log_message "Waiting for CEC device to be available..."
sleep 10

# Test simple de connexion CEC
log_message "Testing CEC connection..."
if timeout 5 cec-client -s -d 1 >/dev/null 2>&1; then
    log_message "CEC connection test successful"
else
    log_message "WARNING: CEC connection test failed, but continuing..."
fi

# Se déclarer comme Audio System (device #5) - méthode simplifiée
log_message "Announcing as Audio System (device #5)"
echo "on 0" | timeout 5 cec-client -s -d 1
echo "as" | timeout 5 cec-client -s -d 1

if [ $? -eq 0 ]; then
    log_message "CEC Amplifier announced successfully"
else
    log_message "WARNING: CEC announcement failed, but continuing..."
fi

# Écouter les commandes CEC en continu
log_message "Listening for CEC commands..."
cec-client -s -d 1 | while read -r line; do
    if [ -n "$line" ]; then
        log_message "CEC received: $line"
        
        # Parser les commandes CEC reçues
        case "$line" in
            *"key pressed: power on"*)
                log_message "CEC: Power ON command received from Apple TV"
                notify_homebridge "power" "on"
                ;;
            *"key pressed: power off"*)
                log_message "CEC: Power OFF command received from Apple TV"
                notify_homebridge "power" "off"
                ;;
            *"key pressed: volume up"*)
                log_message "CEC: Volume UP command received from Apple TV"
                notify_homebridge "volume" "up"
                ;;
            *"key pressed: volume down"*)
                log_message "CEC: Volume DOWN command received from Apple TV"
                notify_homebridge "volume" "down"
                ;;
            *"key pressed: mute"*)
                log_message "CEC: Mute command received from Apple TV"
                notify_homebridge "mute" "toggle"
                ;;
            *"Image View On"*)
                log_message "CEC: Image View On command received"
                notify_homebridge "power" "on"
                ;;
            *"Standby"*)
                log_message "CEC: Standby command received"
                notify_homebridge "power" "off"
                ;;
            *"ERROR"*)
                log_message "CEC: Error detected - $line"
                ;;
            *"opening a connection"*)
                log_message "CEC: Connection opened"
                ;;
        esac
    fi
done

log_message "CEC Amplifier Functional service stopped"
