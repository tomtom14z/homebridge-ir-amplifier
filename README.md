# Homebridge IR Amplifier Plugin

Ce plugin Homebridge permet de contrôler un amplificateur via infrarouge avec support CEC pour l'intégration Apple TV. Il expose l'amplificateur comme un périphérique CEC compatible, permettant à l'Apple TV de le contrôler via HDMI-CEC et d'afficher un slider de volume dans l'interface AirPlay.

## Fonctionnalités

- 🎛️ **Contrôle IR** : Contrôle de l'amplificateur via Broadlink RM3 Pro
- 📊 **Surveillance électrique** : Détection de l'état via TP-Link HS110
- 👁️ **Reconnaissance optique** : Lecture du volume et de la source via OCR
- 📺 **Support CEC** : Intégration Apple TV avec contrôle du volume dans AirPlay
- 🏠 **HomeKit** : Exposition de l'amplificateur dans l'écosystème HomeKit

## Prérequis

### Matériel requis
- Raspberry Pi avec sortie HDMI
- Broadlink RM3 Pro (ou compatible)
- TP-Link HS110 (ou compatible avec API)
- Caméra IP pointant vers l'écran de l'amplificateur
- Amplificateur avec télécommande IR

### Logiciel requis
- Node.js >= 14.0.0
- Homebridge
- libcec-utils (pour le support CEC)

## Installation

### 1. Installation des dépendances système

```bash
# Installation de libcec-utils pour le support CEC
sudo apt-get update
sudo apt-get install cec-utils

# Vérification de l'installation
cec-client --help
```

### 2. Installation du plugin

```bash
# Via npm (recommandé) - Installation automatique du service CEC
sudo npm install -g homebridge-ir-amplifier

# Ou depuis les sources
git clone https://github.com/thomasvernouillet/homebridge-ir-amplifier.git
cd homebridge-ir-amplifier
npm install
npm run build
```

### 3. Configuration Homebridge

Ajoutez la configuration suivante dans votre fichier `config.json` de Homebridge :

```json
{
  "platforms": [
    {
      "platform": "IRAmplifier",
      "name": "IR Amplifier",
      "broadlink": {
        "host": "192.168.1.100",
        "mac": "AA:BB:CC:DD:EE:FF",
        "commands": {
          "power": "2600500000012a...",
          "source": "2600500000012b...",
          "volumeUp": "2600500000012c...",
          "volumeDown": "2600500000012d..."
        }
      },
      "tplink": {
        "host": "192.168.1.101"
      },
      "ocr": {
        "cameraUrl": "http://192.168.1.102:8080/snapshot",
        "checkInterval": 30000
      },
      "cec": {
        "deviceName": "IR Amplifier",
        "physicalAddress": "1.0.0.0",
        "logicalAddress": 5,
        "vendorId": "000000",
        "osdName": "IR AMP"
      }
    }
  ]
}
```

## Configuration

### Broadlink RM3 Pro

1. **Découverte de l'appareil** :
   ```bash
   # Trouver l'adresse IP et MAC de votre Broadlink
   nmap -sn 192.168.1.0/24
   ```

2. **Apprentissage des commandes IR** :
   - Utilisez l'application Broadlink pour apprendre les commandes
   - Ou utilisez la fonction d'apprentissage du plugin (à implémenter)

### TP-Link HS110

1. **Configuration** :
   - Connectez le HS110 à votre réseau
   - Trouvez l'adresse IP dans l'application Kasa
   - Assurez-vous que l'amplificateur est branché sur le HS110

### Caméra IP

1. **Configuration** :
   - Pointez la caméra vers l'écran de l'amplificateur
   - Configurez l'URL de capture (ex: `/snapshot` pour les caméras Foscam)
   - Testez l'accès : `curl http://IP_CAMERA:PORT/snapshot`

### CEC

1. **Configuration HDMI** :
   - Connectez le Raspberry Pi à l'amplificateur via HDMI
   - Connectez l'Apple TV à l'amplificateur via HDMI
   - Vérifiez que CEC est activé sur tous les appareils

2. **Test CEC** :
   ```bash
   # Vérifier les appareils CEC
   echo "scan" | cec-client -s -d 1
   
   # Tester les commandes
   echo "tx 4F:82:10:00" | cec-client -s -d 1
   ```

## Utilisation

### Contrôle via HomeKit

Le plugin expose trois services dans HomeKit :

1. **Switch** : Contrôle d'alimentation de l'amplificateur
2. **Speaker** : Contrôle du volume (0-100%)
3. **Lightbulb** : Contrôle fin du volume via la luminosité

### Intégration Apple TV

Une fois configuré, l'Apple TV devrait :

1. **Détecter l'amplificateur** comme périphérique CEC
2. **Afficher un slider de volume** dans l'interface AirPlay
3. **Contrôler automatiquement** l'amplificateur lors des changements de volume
4. **Allumer/éteindre** l'amplificateur selon les besoins

### Surveillance automatique

Le plugin surveille automatiquement :

- **État d'alimentation** via la consommation électrique (TP-Link)
- **Volume actuel** via reconnaissance optique (OCR)
- **Source active** pour s'assurer qu'elle est sur "VIDEO 2"

## Dépannage

### Problèmes CEC

```bash
# Vérifier les appareils CEC
echo "scan" | cec-client -s -d 1

# Vérifier les logs CEC
echo "log" | cec-client -s -d 1

# Tester une commande
echo "tx 4F:82:10:00" | cec-client -s -d 1
```

### Problèmes IR

1. Vérifiez que les commandes IR sont correctement apprises
2. Assurez-vous que le Broadlink est à portée de l'amplificateur
3. Testez les commandes via l'application Broadlink

### Problèmes OCR

1. Vérifiez que la caméra capture bien l'écran de l'amplificateur
2. Testez l'URL de la caméra dans un navigateur
3. Ajustez la luminosité et le contraste de l'écran de l'amplificateur

## Développement

### Structure du projet

```
src/
├── index.ts              # Plateforme principale
├── platformAccessory.ts  # Accessoire HomeKit
├── broadlinkController.ts # Contrôleur Broadlink
├── tplinkController.ts   # Contrôleur TP-Link
├── ocrController.ts      # Contrôleur OCR
├── cecController.ts      # Contrôleur CEC
└── settings.ts           # Configuration
```

### Compilation

```bash
# Compilation TypeScript
npm run build

# Compilation en mode watch
npm run watch
```

## Licence

MIT

## Support

Pour toute question ou problème, ouvrez une issue sur GitHub.
