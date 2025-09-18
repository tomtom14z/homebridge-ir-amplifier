# Service CEC Amplifier pour Homebridge IR Amplifier

Ce service fait du Raspberry Pi un **vrai device CEC** qui se présente comme un amplificateur audio. L'Apple TV pourra ainsi le contrôler directement via HDMI-CEC.

## 🎯 **Avantages de cette approche :**

- ✅ **Le Pi apparaît dans le scan CEC** comme "Audio System"
- ✅ **L'Apple TV le reconnaît** automatiquement
- ✅ **Contrôle direct** via la télécommande Apple TV
- ✅ **Intégration parfaite** avec le plugin Homebridge
- ✅ **Service systemd** - démarrage automatique

## 📋 **Prérequis :**

```bash
# Installer cec-utils
sudo apt-get update
sudo apt-get install cec-utils

# Vérifier que le device CEC existe
ls -la /dev/cec*
# Doit afficher: /dev/cec0
```

## 🚀 **Installation :**

```bash
# 1. Aller dans le répertoire du plugin
cd /var/lib/homebridge/node_modules/homebridge-ir-amplifier

# 2. Rendre le script d'installation exécutable
sudo chmod +x scripts/install-cec-amplifier.sh

# 3. Exécuter l'installation
sudo ./scripts/install-cec-amplifier.sh

# 4. Démarrer le service
sudo systemctl start cec-amplifier.service
```

## 🔧 **Configuration :**

Le service se configure automatiquement pour :
- **Device Type :** Audio System (device #5)
- **OSD Name :** "Amplifier"
- **Vendor :** "Homebridge"

## 📊 **Surveillance :**

```bash
# Voir les logs du service
sudo journalctl -u cec-amplifier.service -f

# Voir les logs du fichier
tail -f /var/log/cec-amplifier.log

# Vérifier le statut
sudo systemctl status cec-amplifier.service
```

## 🎮 **Test :**

1. **Scanner le bus CEC :**
   ```bash
   cec-client -s -d 1
   ```
   Vous devriez voir le Pi apparaître comme "Audio System"

2. **Tester avec l'Apple TV :**
   - Utilisez la télécommande Apple TV
   - Les commandes power/volume devraient déclencher les actions IR

3. **Vérifier les logs Homebridge :**
   ```bash
   sudo journalctl -u homebridge -f | grep "CEC:"
   ```

## 🔄 **Gestion du service :**

```bash
# Démarrer
sudo systemctl start cec-amplifier.service

# Arrêter
sudo systemctl stop cec-amplifier.service

# Redémarrer
sudo systemctl restart cec-amplifier.service

# Désactiver
sudo systemctl disable cec-amplifier.service
```

## 🐛 **Dépannage :**

### **Le service ne démarre pas :**
```bash
# Vérifier les logs
sudo journalctl -u cec-amplifier.service

# Vérifier que cec-client est installé
which cec-client

# Vérifier les permissions
ls -la /dev/cec0
```

### **Le Pi n'apparaît pas dans le scan CEC :**
```bash
# Tester manuellement
echo "on 0" | cec-client -s -d 1
echo "as" | cec-client -s -d 1

# Vérifier le statut CEC
cec-client -s -d 1
```

### **Les commandes ne sont pas reçues :**
```bash
# Vérifier le fichier de communication
ls -la /tmp/cec-to-homebridge.json

# Vérifier les logs Homebridge
sudo journalctl -u homebridge -f | grep "CEC: Command received"
```

## 📝 **Fichiers créés :**

- `/usr/local/bin/cec-amplifier.sh` - Script principal
- `/etc/systemd/system/cec-amplifier.service` - Service systemd
- `/var/log/cec-amplifier.log` - Logs du service
- `/tmp/cec-to-homebridge.json` - Communication avec Homebridge

## 🔧 **Personnalisation :**

Pour modifier le comportement, éditez `/usr/local/bin/cec-amplifier.sh` et redémarrez le service :

```bash
sudo systemctl restart cec-amplifier.service
```
