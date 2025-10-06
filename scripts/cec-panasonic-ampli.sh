#!/bin/bash

# CEC Panasonic Ampli - using cec-follower with corrected options for your version
# Script fonctionnel de Grok intégré dans le plugin Homebridge IR Amplifier

LOG_FILE="/tmp/cec-panasonic-ampli.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

notify_homebridge() {
    local action="$1"
    local value="$2"
    
    # Attendre un peu si le fichier existe déjà (éviter les conflits)
    while [ -f "/var/lib/homebridge/cec-to-homebridge.json" ] && [ -s "/var/lib/homebridge/cec-to-homebridge.json" ]; do
        log "⏳ Waiting for Homebridge to process previous command..."
        sleep 0.1
    done
    
    # Créer le JSON de manière atomique pour éviter la corruption
    local json_data="{\"action\":\"$action\",\"value\":\"$value\",\"timestamp\":$(date +%s)}"
    echo "$json_data" > /var/lib/homebridge/cec-to-homebridge.json.tmp
    
    # Définir le propriétaire et les permissions pour Homebridge
    chown homebridge:homebridge /var/lib/homebridge/cec-to-homebridge.json.tmp
    chmod 666 /var/lib/homebridge/cec-to-homebridge.json.tmp
    mv /var/lib/homebridge/cec-to-homebridge.json.tmp /var/lib/homebridge/cec-to-homebridge.json
    log "📱 File created with owner homebridge:homebridge and permissions 666"
    log "📱 Notified Homebridge: $action=$value (via /var/lib/homebridge/cec-to-homebridge.json)"
}

# Fonction pour lire l'état de Homebridge et synchroniser l'état CEC
sync_cec_state_from_homebridge() {
    local state_file="/var/lib/homebridge/homebridge-to-cec.json"
    
    if [ -f "$state_file" ]; then
        # Lire l'état de Homebridge
        local power_state=$(jq -r '.power' "$state_file" 2>/dev/null)
        local timestamp=$(jq -r '.timestamp' "$state_file" 2>/dev/null)
        
        if [ "$power_state" = "on" ] || [ "$power_state" = "off" ]; then
            log "📡 Homebridge state: $power_state (timestamp: $timestamp)"
            
            # Mettre à jour l'état CEC en conséquence
            if [ "$power_state" = "on" ]; then
                log "🔋 Syncing CEC state to ON"
                cec-ctl -d /dev/cec0 --audio --power-on >/dev/null 2>&1
            else
                log "🛑 Syncing CEC state to STANDBY"
                cec-ctl -d /dev/cec0 --audio --standby >/dev/null 2>&1
            fi
            
            # Supprimer le fichier après traitement
            rm -f "$state_file"
        else
            # Vérifier s'il y a une commande HDMI1
            local action=$(jq -r '.action' "$state_file" 2>/dev/null)
            if [ "$action" = "hdmi1" ]; then
                log "📺 Homebridge requested HDMI1 switch (timestamp: $timestamp)"
                
                # Envoyer la commande HDMI1 via CEC
                log "📺 Sending HDMI1 command to TV..."
                # Utiliser l'adresse physique d'Apple TV (1.0.0.0 = 4096 en décimal)
                cec-ctl -d /dev/cec0 --to 0 --active-source 4096 >/dev/null 2>&1
                if [ $? -eq 0 ]; then
                    log "✅ HDMI1 command sent successfully (Apple TV address: 1.0.0.0)"
                else
                    log "❌ HDMI1 command failed, trying alternative syntax..."
                    # Essayer avec l'adresse hex
                    cec-ctl -d /dev/cec0 --to 0 --active-source 1000 >/dev/null 2>&1
                    if [ $? -eq 0 ]; then
                        log "✅ HDMI1 command sent successfully (hex format: 1000)"
                    else
                        log "❌ Trying direct tx command..."
                        # Essayer la commande directe
                        cec-ctl -d /dev/cec0 --to 0 tx 4F:82:10:00 >/dev/null 2>&1
                        if [ $? -eq 0 ]; then
                            log "✅ HDMI1 command sent successfully (direct tx)"
                        else
                            log "❌ All HDMI1 command attempts failed"
                        fi
                    fi
                fi
                
                # Supprimer le fichier après traitement
                rm -f "$state_file"
            fi
        fi
    fi
}

log "🎛️ CEC Panasonic Ampli - using cec-follower"

# Vérifier que cec-ctl et cec-follower sont disponibles
if ! command -v cec-ctl &> /dev/null; then
    log "ERROR: cec-ctl not found. Please install cec-utils"
    exit 1
fi

if ! command -v cec-follower &> /dev/null; then
    log "ERROR: cec-follower not found. Please install cec-utils"
    exit 1
fi

# Vérifier que le device CEC existe
if [ ! -e "/dev/cec0" ]; then
    log "ERROR: CEC device /dev/cec0 not found"
    exit 1
fi

# 1. Configure Audio System
log "🔧 Configuring Audio System..."
cec-ctl -d /dev/cec0 --audio -o "Panasonic HT" >/dev/null 2>&1
sleep 1
cec-ctl -d /dev/cec0 --audio -V 008045 >/dev/null 2>&1
sleep 1
cec-ctl -d /dev/cec0 --cec-version-1.4 >/dev/null 2>&1
sleep 1

# 2. Set Features (including system audio mode support)
log "📡 Setting Features..."
cec-ctl -d /dev/cec0 --audio --feat-set-audio-rate >/dev/null 2>&1
cec-ctl -d /dev/cec0 --audio --feat-sink-has-arc-tx >/dev/null 2>&1
cec-ctl -d /dev/cec0 --audio --feat-set-system-audio-mode >/dev/null 2>&1

# 3. Verification
log "📊 Verification..."
cec-ctl -d /dev/cec0 -S 2>&1 | tee -a "$LOG_FILE"

# 4. Démarrer la synchronisation périodique de l'état CEC avec Homebridge
log "🔄 Starting periodic CEC state synchronization with Homebridge..."
(
    while true; do
        sleep 10  # Vérifier toutes les 10 secondes
        sync_cec_state_from_homebridge
    done
) &
SYNC_PID=$!

# 5. Start cec-follower with options from your system's usage (-v -w -m -s) and parse output in real-time
log "📡 Starting cec-follower monitoring (with verbose, wall-clock timestamps, show-msgs, show-state) - Ctrl+C to stop"
log "🎛️ Select 'Home Cinema' in VIERA Link and test volume/power!"

cec-follower -d /dev/cec0 -v -w -m -s | while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    
    log "EVENT: $line"
    
    # Detect User Control Pressed (0x44) for volume/mute/power buttons
    if echo "$line" | grep -iq "user control pressed|0x44|user-rc-button|rc code pressed"; then
        log "🎛️ TELECOMMANDE détectée ! (possible volume/mute/power)"
    fi
    
    # Volume Up (volume-up or 0x41) - détecter sur la ligne suivante
    if echo "$line" | grep -iq "ui-cmd: volume-up"; then
        log "🔊 VOLUME UP Panasonic!"
        amixer set Master 2%+ >/dev/null 2>&1  # Optional: local audio adjust if Raspberry Pi audio is in use
        notify_homebridge "volume" "up"
    fi
        
    # Volume Down (volume-down or 0x42)
    if echo "$line" | grep -iq "ui-cmd: volume-down"; then
        log "🔉 VOLUME DOWN Panasonic!"
        amixer set Master 2%- >/dev/null 2>&1
        notify_homebridge "volume" "down"
    fi
        
    # Mute (mute or 0x43)
    if echo "$line" | grep -iq "ui-cmd: mute"; then
        log "🔇 MUTE Panasonic!"
        amixer set Master toggle >/dev/null 2>&1
        notify_homebridge "mute" "toggle"
    fi
    
    # Power-related User Control (expand if your remote sends these for power)
    if echo "$line" | grep -iq "ui-cmd: power-on"; then
        log "🔋 POWER ON/Toggle Panasonic! (via user control)"
        notify_homebridge "power" "on"
    fi
    if echo "$line" | grep -iq "ui-cmd: power-off"; then
        log "🛑 POWER OFF Panasonic! (via user control)"
        notify_homebridge "power" "standby"
    fi
    
    # Log current volume after volume/mute change
    if echo "$line" | grep -iq "volume|mute|0x41|0x42|0x43"; then
        VOLUME=$(amixer get Master | grep -o '[0-9]\+%' | head -1 | sed 's/%//')
        log "📶 Volume Panasonic: ${VOLUME}%"
    fi
    
    # Power On (via System Audio Mode Request 0x70 as trigger)
    if echo "$line" | grep -iq "system audio mode request|0x70"; then
        log "🔋 POWER ON Panasonic! (via audio mode request)"
        notify_homebridge "power" "on"
    fi
    
    # Power On (via REPORT_POWER_STATUS: pwr-state: on)
    if echo "$line" | grep -iq "pwr-state: on.*0x00"; then
        log "🔋 POWER ON Panasonic! (via power status report)"
        notify_homebridge "power" "on"
    fi
    
    # Standby (standby or 0x36)
    if echo "$line" | grep -iq "STANDBY.*0x36"; then
        log "🛑 STANDBY Panasonic!"
        notify_homebridge "power" "standby"
    fi
done

# Nettoyer le processus de synchronisation
log "🔄 Stopping CEC state synchronization..."
kill $SYNC_PID 2>/dev/null

log "CEC Panasonic Ampli service stopped"
