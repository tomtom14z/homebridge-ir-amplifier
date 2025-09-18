#!/bin/bash

# Script CEC Amplifier pour Homebridge IR Amplifier
# Fait du Raspberry Pi un device CEC qui se présente comme un amplificateur audio

LOG_FILE="/var/log/cec-amplifier.log"
CEC_DEVICE="/dev/cec0"

# Fonction de logging
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Fonction pour envoyer des commandes à Homebridge
notify_homebridge() {
    local action="$1"
    local value="$2"
    
    # Envoyer un signal au plugin Homebridge via un fichier de communication
    echo "{\"action\":\"$action\",\"value\":\"$value\",\"timestamp\":$(date +%s)}" > /tmp/cec-to-homebridge.json
    
    log_message "Notified Homebridge: $action = $value"
}

# Fonction pour gérer les commandes CEC
handle_cec_command() {
    local command="$1"
    
    case "$command" in
        "power on"|"on")
            log_message "CEC: Power ON command received"
            notify_homebridge "power" "on"
            ;;
        "power off"|"standby")
            log_message "CEC: Power OFF command received"
            notify_homebridge "power" "off"
            ;;
        "volume up"|"volup")
            log_message "CEC: Volume UP command received"
            notify_homebridge "volume" "up"
            ;;
        "volume down"|"voldown")
            log_message "CEC: Volume DOWN command received"
            notify_homebridge "volume" "down"
            ;;
        "mute")
            log_message "CEC: Mute command received"
            notify_homebridge "mute" "toggle"
            ;;
        *)
            log_message "CEC: Unknown command received: $command"
            ;;
    esac
}

# Vérifier que cec-client est disponible
if ! command -v cec-client &> /dev/null; then
    log_message "ERROR: cec-client not found. Please install libcec-dev"
    exit 1
fi

# Vérifier que le device CEC existe
if [ ! -e "$CEC_DEVICE" ]; then
    log_message "ERROR: CEC device $CEC_DEVICE not found"
    exit 1
fi

log_message "Starting CEC Amplifier service..."

# Se présenter comme un amplificateur audio (device #5)
log_message "Announcing as Audio System (device #5)"
echo "on 0" | cec-client -s -d 1
echo "as" | cec-client -s -d 1

# Écouter les commandes CEC en continu
log_message "Listening for CEC commands..."
cec-client -s -d 1 | while read -r line; do
    if [ -n "$line" ]; then
        log_message "CEC received: $line"
        
        # Parser les commandes CEC
        if echo "$line" | grep -q "key pressed: power on"; then
            handle_cec_command "power on"
        elif echo "$line" | grep -q "key pressed: power off"; then
            handle_cec_command "power off"
        elif echo "$line" | grep -q "key pressed: volume up"; then
            handle_cec_command "volume up"
        elif echo "$line" | grep -q "key pressed: volume down"; then
            handle_cec_command "volume down"
        elif echo "$line" | grep -q "key pressed: mute"; then
            handle_cec_command "mute"
        fi
    fi
done

log_message "CEC Amplifier service stopped"
