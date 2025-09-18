#!/bin/bash

# Script CEC Amplifier v2 pour Homebridge IR Amplifier
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

log_message "Starting CEC Amplifier v2 service..."

# Se déclarer comme Audio System (adresse 5)
log_message "Announcing as Audio System (device #5)"
echo "tx 50:47:41:4d:50:4c:49" | cec-client -s -d 1  # Nom "AMPLi"
echo "tx 5f:84:40:00:05" | cec-client -s -d 1        # Audio System à 4000
echo "tx 5f:87:00:00:00" | cec-client -s -d 1        # Vendor ID générique

# Se mettre en mode "on" pour être visible
echo "on 0" | cec-client -s -d 1

log_message "CEC Amplifier v2 announced successfully"

# Écouter les commandes CEC en continu (méthode passive)
log_message "Listening for CEC commands..."
cec-client -s -d 1 | while read -r line; do
    if [ -n "$line" ]; then
        log_message "CEC received: $line"
        
        # Parser les commandes CEC reçues
        case "$line" in
            *"key pressed: power on"*)
                log_message "CEC: Power ON command received"
                notify_homebridge "power" "on"
                ;;
            *"key pressed: power off"*)
                log_message "CEC: Power OFF command received"
                notify_homebridge "power" "off"
                ;;
            *"key pressed: volume up"*)
                log_message "CEC: Volume UP command received"
                notify_homebridge "volume" "up"
                ;;
            *"key pressed: volume down"*)
                log_message "CEC: Volume DOWN command received"
                notify_homebridge "volume" "down"
                ;;
            *"key pressed: mute"*)
                log_message "CEC: Mute command received"
                notify_homebridge "mute" "toggle"
                ;;
            *"key pressed: unmute"*)
                log_message "CEC: Unmute command received"
                notify_homebridge "mute" "off"
                ;;
            *"Image View On"*)
                log_message "CEC: Image View On command received"
                notify_homebridge "power" "on"
                ;;
            *"Standby"*)
                log_message "CEC: Standby command received"
                notify_homebridge "power" "off"
                ;;
            *)
                # Log des commandes non reconnues pour debug
                if [[ "$line" == *"key pressed:"* ]] || [[ "$line" == *"Image View"* ]] || [[ "$line" == *"Standby"* ]]; then
                    log_message "CEC: Unhandled command: $line"
                fi
                ;;
        esac
    fi
done

log_message "CEC Amplifier v2 service stopped"
