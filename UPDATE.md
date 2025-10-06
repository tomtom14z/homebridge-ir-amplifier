# 🔄 Mise à jour du plugin homebridge-ir-amplifier

## 📦 Mise à jour automatique sur Raspberry Pi

### Méthode 1 : Script automatique (recommandé)

```bash
# Utiliser le script local du plugin installé
NPM_GLOBAL_PATH=$(npm root -g)
bash "$NPM_GLOBAL_PATH/homebridge-ir-amplifier/scripts/update-cec-service.sh"
```

Ce script va :
1. ✅ Mettre à jour le plugin npm
2. ✅ Arrêter le service CEC
3. ✅ Mettre à jour le script CEC (cec-panasonic-ampli.sh)
4. ✅ Redémarrer le service CEC
5. ✅ Redémarrer Homebridge
6. ✅ Afficher les statuts

### Méthode 2 : Mise à jour manuelle

```bash
# 1. Mettre à jour le plugin npm
sudo npm update -g homebridge-ir-amplifier

# 2. Arrêter le service CEC
sudo systemctl stop cec-panasonic-ampli

# 3. Mettre à jour le script CEC (cec-panasonic-ampli.sh)
NPM_GLOBAL_PATH=$(npm root -g)
PLUGIN_PATH="$NPM_GLOBAL_PATH/homebridge-ir-amplifier"
sudo cp "$PLUGIN_PATH/scripts/cec-panasonic-ampli.sh" /usr/local/bin/cec-panasonic-ampli.sh
sudo chmod +x /usr/local/bin/cec-panasonic-ampli.sh

# 4. Redémarrer le service CEC
sudo systemctl restart cec-panasonic-ampli

# 5. Redémarrer Homebridge
sudo systemctl restart homebridge
```

### Méthode 3 : Commande directe (plus simple)

```bash
# Mise à jour en une seule commande
bash /usr/local/lib/node_modules/homebridge-ir-amplifier/scripts/update-cec-service.sh
```

## 📋 Vérification après mise à jour

### Vérifier les logs CEC
```bash
sudo journalctl -u cec-panasonic-ampli -f
```

### Vérifier les logs Homebridge
```bash
sudo journalctl -u homebridge -f
```

### Vérifier les statuts
```bash
# Statut du service CEC
sudo systemctl status cec-panasonic-ampli

# Statut de Homebridge
sudo systemctl status homebridge
```

## 🆘 Dépannage

### Le service CEC ne démarre pas

```bash
# Vérifier les permissions du script
ls -la /usr/local/bin/cec-panasonic-ampli.sh

# Donner les bonnes permissions
sudo chmod +x /usr/local/bin/cec-panasonic-ampli.sh
sudo chown root:root /usr/local/bin/cec-panasonic-ampli.sh

# Redémarrer le service
sudo systemctl restart cec-panasonic-ampli
```

### Les logs CEC montrent des erreurs

```bash
# Réinstaller le service CEC
sudo systemctl stop cec-panasonic-ampli
NPM_GLOBAL_PATH=$(npm root -g)
bash "$NPM_GLOBAL_PATH/homebridge-ir-amplifier/scripts/install-cec-panasonic.sh"
```

## 📝 Versions

Pour voir la version installée :

```bash
npm list -g homebridge-ir-amplifier
```

## 🔗 Liens utiles

- [GitHub](https://github.com/tomtom14z/homebridge-ir-amplifier)
- [npm](https://www.npmjs.com/package/homebridge-ir-amplifier)
- [Issues](https://github.com/tomtom14z/homebridge-ir-amplifier/issues)

