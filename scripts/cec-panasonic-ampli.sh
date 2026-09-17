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
    local waited=0
    
    # Ne pas bloquer cec-follower si Homebridge n'a pas consommé le fichier
    # (cas fréquent après réinstall : JSON restant ou plugin pas encore prêt)
    while [ -f "/var/lib/homebridge/cec-to-homebridge.json" ] && [ -s "/var/lib/homebridge/cec-to-homebridge.json" ] && [ "$waited" -lt 20 ]; do
        log "⏳ Waiting for Homebridge to process previous command... (${waited}/20)"
        sleep 0.1
        waited=$((waited + 1))
    done
    if [ "$waited" -ge 20 ]; then
        log "⚠️ Homebridge n'a pas consommé cec-to-homebridge.json — overwrite"
    fi
    
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

refuse_arc() {
    log "⛔ ARC refused (optical → home cinema, Pi is not an HDMI AVR)"
    cec-ctl -d /dev/cec0 --to 0 --report-arc-terminated >/dev/null 2>&1 || \
        cec-ctl -d /dev/cec0 --to 0 --feature-abort reason=refused >/dev/null 2>&1 || true
}

report_cec_audio_status() {
    local vol="$1"
    local mute="$2"
    log "📶 CEC Report Audio Status volume=${vol} mute=${mute}"
    # TV (0) puis Apple TV / playback (4)
    cec-ctl -d /dev/cec0 --to 0 --report-audio-status "aud-mute=${mute},aud-vol-lfe=${vol}" >/dev/null 2>&1 || \
        cec-ctl -d /dev/cec0 --to 0 --report-audio-status aud-mute="${mute}",aud-vol-lfe="${vol}" >/dev/null 2>&1
    cec-ctl -d /dev/cec0 --to 4 --report-audio-status "aud-mute=${mute},aud-vol-lfe=${vol}" >/dev/null 2>&1 || true
}

# OSD TV : compteur 0–100 indépendant du volume HomeKit (startupVolume=7, OCR, etc.)
adjust_cec_osd_volume() {
    local delta="$1"
    local vol=50
    local mute=0
    [ -f /var/lib/homebridge/cec-last-volume ] && vol=$(cat /var/lib/homebridge/cec-last-volume)
    [ -f /var/lib/homebridge/cec-last-mute ] && mute=$(cat /var/lib/homebridge/cec-last-mute)
    [[ "$vol" =~ ^[0-9]+$ ]] || vol=50
    vol=$((vol + delta))
    [ "$vol" -gt 100 ] && vol=100
    [ "$vol" -lt 0 ] && vol=0
    mute=0
    echo "$vol" > /var/lib/homebridge/cec-last-volume
    echo "$mute" > /var/lib/homebridge/cec-last-mute
    report_cec_audio_status "$vol" "$mute"
}

sync_cec_audio_from_homebridge() {
    local audio_file="/var/lib/homebridge/homebridge-to-cec-audio.json"
    if [ ! -f "$audio_file" ]; then
        return
    fi

    local mute
    mute=$(jq -r '.mute' "$audio_file" 2>/dev/null)
    rm -f "$audio_file"

    # Mute uniquement. Le volume HomeKit (init à 7 crans) ne doit pas remplacer l'OSD relatif.
    [ "$mute" = "1" ] || mute=0
    local prev_mute=0
    [ -f /var/lib/homebridge/cec-last-mute ] && prev_mute=$(cat /var/lib/homebridge/cec-last-mute)
    [ "$prev_mute" = "1" ] || prev_mute=0
    if [ "$mute" = "$prev_mute" ]; then
        return
    fi

    local vol=50
    [ -f /var/lib/homebridge/cec-last-volume ] && vol=$(cat /var/lib/homebridge/cec-last-volume)
    [[ "$vol" =~ ^[0-9]+$ ]] || vol=50
    echo "$mute" > /var/lib/homebridge/cec-last-mute
    report_cec_audio_status "$vol" "$mute"
}

LAST_GIVE_AUDIO_REPLY=0

reply_give_audio_status() {
    local now
    now=$(date +%s)
    if [ $((now - LAST_GIVE_AUDIO_REPLY)) -lt 1 ]; then
        return
    fi
    LAST_GIVE_AUDIO_REPLY=$now

    local vol=50
    local mute=0
    [ -f /var/lib/homebridge/cec-last-volume ] && vol=$(cat /var/lib/homebridge/cec-last-volume)
    [ -f /var/lib/homebridge/cec-last-mute ] && mute=$(cat /var/lib/homebridge/cec-last-mute)
    [[ "$vol" =~ ^[0-9]+$ ]] || vol=50
    [ "$mute" = "1" ] || mute=0
    log "📥 Give Audio Status (0x71) → reply volume=${vol} mute=${mute}"
    report_cec_audio_status "$vol" "$mute"
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
                log "🛑 Amp électrique OFF — on garde l'Audio System CEC (pas de standby, sinon la TV coupe le son)"
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
                # Utiliser --active-source avec l'adresse physique de l'Apple TV (HDMI1 = 1.0.0.0 = 0x1000)
                # Cette commande est un broadcast, pas besoin de --to
                cec-ctl -d /dev/cec0 --active-source phys-addr=0x1000 >/dev/null 2>&1
                if [ $? -eq 0 ]; then
                    log "✅ HDMI1 command sent successfully (active-source phys-addr=0x1000)"
                else
                    log "❌ HDMI1 command failed"
                    log "🔍 Debug: Testing cec-ctl version and permissions..."
                    cec-ctl --version 2>&1 | head -1
                    log "🔍 Debug: Testing device access..."
                    ls -la /dev/cec0 2>&1
                fi
                
                # Supprimer le fichier après traitement
                rm -f "$state_file"
            fi
        fi
    fi
}

log "🎛️ CEC Panasonic Ampli - using cec-follower"

mkdir -p /var/lib/homebridge
if [ ! -f /var/lib/homebridge/cec-last-volume ]; then
    echo 50 > /var/lib/homebridge/cec-last-volume
fi
echo 0 > /var/lib/homebridge/cec-last-mute

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

# 2. Set Features — Audio System for volume keys, PAS d'ARC
# (ARC ferait couper les HP TV : le Pi n'est pas un vrai ampli HDMI)
log "📡 Setting Features (no ARC)..."
cec-ctl -d /dev/cec0 --audio --feat-set-audio-rate >/dev/null 2>&1
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

log "🔄 Starting CEC audio status watcher..."
(
    while true; do
        sleep 0.2
        sync_cec_audio_from_homebridge
    done
) &
AUDIO_PID=$!

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
        adjust_cec_osd_volume 1
        notify_homebridge "volume" "up"
    fi
        
    # Volume Down (volume-down or 0x42)
    if echo "$line" | grep -iq "ui-cmd: volume-down"; then
        log "🔉 VOLUME DOWN Panasonic!"
        amixer set Master 2%- >/dev/null 2>&1
        adjust_cec_osd_volume -1
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
    
    if echo "$line" | grep -Eiq "give-audio-status|give audio status|opcode: 0x71"; then
        reply_give_audio_status
    fi
    
    if echo "$line" | grep -Eiq "REQUEST_ARC_INITIATION|request-arc-initiation"; then
        refuse_arc
    fi
    
    # Log current volume after volume/mute change
    if echo "$line" | grep -iq "volume|mute|0x41|0x42|0x43"; then
        VOLUME=$(amixer get Master | grep -o '[0-9]\+%' | head -1 | sed 's/%//')
        log "📶 Volume Panasonic: ${VOLUME}%"
    fi
    
    # 0x70 = System Audio Mode Request, PAS un power on.
    # phys-addr f.f.f.f = SAM off (la TV reprend ses HP) — ne pas allumer l'ampli IR.
    
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
kill $AUDIO_PID 2>/dev/null

log "CEC Panasonic Ampli service stopped"
