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

# 4. Start cec-follower with options from your system's usage (-v -w -m -s) and parse output in real-time
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
        
    # Volume Down (volume-down or 0x42)
    if echo "$line" | grep -iq "ui-cmd: volume-down"; then
        log "🔉 VOLUME DOWN Panasonic!"
        amixer set Master 2%- >/dev/null 2>&1
        notify_homebridge "volume" "down"
        
    # Mute (mute or 0x43)
    if echo "$line" | grep -iq "ui-cmd: mute"; then
        log "🔇 MUTE Panasonic!"
        amixer set Master toggle >/dev/null 2>&1
        notify_homebridge "mute" "toggle"
    
    # Power-related User Control (expand if your remote sends these for power)
    if echo "$line" | grep -iq "ui-cmd: power-on"; then
        log "🔋 POWER ON/Toggle Panasonic! (via user control)"
        notify_homebridge "power" "on"
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
    
    # Standby (standby or 0x36)
    if echo "$line" | grep -iq "STANDBY.*0x36"; then
        log "🛑 STANDBY Panasonic!"
        notify_homebridge "power" "standby"
    fi
done

log "CEC Panasonic Ampli service stopped"
