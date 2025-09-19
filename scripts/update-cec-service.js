#!/usr/bin/env node

/**
 * Script de mise à jour du service CEC Panasonic Ampli
 * À exécuter manuellement après une mise à jour du plugin
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔄 homebridge-ir-amplifier: Mise à jour du service CEC Panasonic Ampli...');

// Vérifier si nous sommes sur un système Linux
if (process.platform !== 'linux') {
    console.log('ℹ️  Service CEC non installé - système non-Linux détecté');
    process.exit(0);
}

// Vérifier si nous sommes root ou si sudo est disponible
const isRoot = process.getuid && process.getuid() === 0;
const hasSudo = !isRoot && execSync('which sudo', { stdio: 'ignore' });

if (!isRoot && !hasSudo) {
    console.log('⚠️  Service CEC non installé - privilèges root requis');
    console.log('   Pour installer manuellement: sudo ./scripts/install-cec-panasonic.sh');
    process.exit(0);
}

try {
    // Arrêter le service existant s'il existe
    try {
        console.log('🛑 Arrêt du service CEC existant...');
        execSync('systemctl stop cec-panasonic-ampli.service', { stdio: 'ignore' });
    } catch (error) {
        console.log('ℹ️  Aucun service CEC existant à arrêter');
    }

    // Vérifier que cec-utils est installé
    try {
        execSync('which cec-ctl', { stdio: 'ignore' });
        execSync('which cec-follower', { stdio: 'ignore' });
    } catch (error) {
        console.log('⚠️  cec-utils non trouvé - installation du service CEC ignorée');
        console.log('   Installez cec-utils: sudo apt-get install cec-utils');
        console.log('   Puis installez manuellement: sudo ./scripts/install-cec-panasonic.sh');
        process.exit(0);
    }

    // Vérifier que le device CEC existe
    if (!fs.existsSync('/dev/cec0')) {
        console.log('⚠️  Device CEC /dev/cec0 non trouvé - installation du service CEC ignorée');
        console.log('   Vérifiez que votre Raspberry Pi supporte CEC');
        console.log('   Puis installez manuellement: sudo ./scripts/install-cec-panasonic.sh');
        process.exit(0);
    }

    // Obtenir le répertoire du plugin
    const pluginDir = __dirname.replace('/scripts', '');
    
    // Rendre le script d'installation exécutable
    const installScript = path.join(pluginDir, 'scripts', 'install-cec-panasonic.sh');
    if (fs.existsSync(installScript)) {
        fs.chmodSync(installScript, '755');
        
        // Exécuter l'installation
        const command = isRoot ? 
            `"${installScript}"` : 
            `sudo "${installScript}"`;
        
        console.log('🔧 Installation/mise à jour du service CEC Panasonic Ampli...');
        execSync(command, { stdio: 'inherit', cwd: pluginDir });
        
        console.log('✅ Service CEC Panasonic Ampli mis à jour avec succès!');
        console.log('🎛️  Le plugin peut maintenant recevoir les commandes CEC de l\'Apple TV');
        console.log('');
        console.log('📋 Commandes utiles:');
        console.log('   sudo systemctl status cec-panasonic-ampli.service');
        console.log('   sudo journalctl -u cec-panasonic-ampli.service -f');
        console.log('   tail -f /var/log/cec-panasonic-ampli.log');
        
    } else {
        console.log('⚠️  Script d\'installation CEC non trouvé');
    }

} catch (error) {
    console.log('❌ Erreur lors de la mise à jour du service CEC:', error.message);
    console.log('   Installation manuelle: sudo ./scripts/install-cec-panasonic.sh');
}

console.log('🎉 Mise à jour du service CEC terminée!');
