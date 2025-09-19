# Service CEC Panasonic Ampli - Installation Automatique

## 🎯 **Installation automatique**

Le service CEC Panasonic Ampli s'installe **automatiquement** lors de l'installation du plugin via npm :

```bash
sudo npm install -g homebridge-ir-amplifier
```

## ✅ **Prérequis automatiquement vérifiés**

- ✅ Système Linux (Raspberry Pi)
- ✅ `cec-utils` installé (`sudo apt-get install cec-utils`)
- ✅ Device CEC disponible (`/dev/cec0`)
- ✅ Privilèges root (via sudo)

## 🔧 **Installation manuelle (si nécessaire)**

Si l'installation automatique échoue :

```bash
# Aller dans le répertoire du plugin
cd /var/lib/homebridge/node_modules/homebridge-ir-amplifier

# Installer manuellement
sudo ./scripts/install-cec-panasonic.sh
```

## 🎛️ **Fonctionnalités**

Le service CEC Panasonic Ampli permet à l'Apple TV de contrôler l'amplificateur via HDMI-CEC :

- 🔊 **Volume UP/DOWN** - Commande IR vers l'amplificateur
- 🔇 **Mute** - Commande IR vers l'amplificateur  
- 🔋 **Power ON/OFF** - Commande IR vers l'amplificateur
- 📱 **Communication Homebridge** - Via fichier JSON

## 📊 **Surveillance**

```bash
# Statut du service
sudo systemctl status cec-panasonic-ampli.service

# Logs en temps réel
sudo journalctl -u cec-panasonic-ampli.service -f

# Logs du fichier
tail -f /var/log/cec-panasonic-ampli.log

# Test de communication
ls -la /tmp/cec-to-homebridge.json
```

## 🔍 **Test**

```bash
# Test du service
sudo ./scripts/test-cec-panasonic.sh

# Configuration CEC
sudo cec-ctl -d /dev/cec0 -S
```

## 🗑️ **Désinstallation**

```bash
# Désinstaller le service CEC
sudo ./scripts/uninstall-cec-panasonic.sh

# Désinstaller le plugin
sudo npm uninstall -g homebridge-ir-amplifier
```

## 🎯 **Configuration Apple TV**

1. **Sélectionner "Home Cinema"** dans VIERA Link
2. **Utiliser la télécommande Apple TV** pour volume/power
3. **Le plugin reçoit les commandes CEC** et envoie les commandes IR

## 🐛 **Dépannage**

### **Service ne démarre pas :**
```bash
# Vérifier les logs
sudo journalctl -u cec-panasonic-ampli.service

# Vérifier cec-utils
which cec-ctl cec-follower

# Vérifier le device CEC
ls -la /dev/cec0
```

### **Commandes CEC non reçues :**
```bash
# Vérifier la configuration CEC
sudo cec-ctl -d /dev/cec0 -S

# Tester manuellement
echo "tx 04:44:41" | sudo cec-ctl -d /dev/cec0
```

### **Communication Homebridge :**
```bash
# Vérifier le fichier de communication
cat /tmp/cec-to-homebridge.json

# Vérifier les logs Homebridge
sudo journalctl -u homebridge -f | grep "CEC:"
```
