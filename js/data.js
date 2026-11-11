'use strict';
/* HORDE — données du jeu : classes, arbres de compétences, zombies. */

const SAVE_KEY = 'horde-save-v1';
const DEG = Math.PI / 180;

const pc = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + ' %';
const fmt = v => (Math.round(v * 10) / 10).toString().replace('.', ',');

/* ------------------------------------------------------------------ */
/* Arbres de compétences                                               */
/* Chaque nœud : id, nom, icône, description, niveau max, coût de base,  */
/* multiplicateur de coût, prérequis [[id, niveau]], position (x, y),   */
/* fx(niveau) → texte de l'effet à ce niveau.                           */
/* Le dernier rang (niveau max) demande énormément d'âmes mais offre    */
/* un bond de puissance majeur.                                        */
/* ------------------------------------------------------------------ */

const TREES = {
  samurai: {
    branches: [
      { name: 'Sabre', x: 0.5 },
      { name: 'Ki', x: 2.75 },
      { name: 'Poussée', x: 4.75 },
      { name: 'Stase', x: 6.75 },
      { name: 'Corps', x: 9 },
    ],
    nodes: [
      // --- Sabre ---
      { id: 'blade_dmg', name: 'Tranchant', icon: '🗡️', max: 20, cost: 8, mult: 1.42, x: 0.5, y: 0,
        desc: 'Les coups de sabre font plus de dégâts. Rang ultime : maîtrise absolue de la lame.',
        fx: l => pc(l >= 20 ? 4.0 : 0.14 * l) + ' de dégâts au sabre' },
      { id: 'blade_speed', name: 'Rapidité', icon: '💨', max: 8, cost: 14, mult: 1.45, x: 0, y: 1, req: [['blade_dmg', 2]],
        desc: 'Frappe plus vite (attention : frapper plus souvent consomme plus de Ki par seconde).',
        fx: l => '-' + Math.round((1 - (l >= 8 ? 0.44 : Math.pow(0.93, l))) * 100) + ' % de temps entre deux coups' },
      { id: 'blade_reach', name: 'Allonge', icon: '📏', max: 5, cost: 16, mult: 1.55, x: 1, y: 1, req: [['blade_dmg', 2]],
        desc: 'Le sabre porte plus loin et balaie un arc plus large.',
        fx: l => l >= 5 ? '+65 % de portée, +85° d\'arc' : pc(0.08 * l) + ' de portée, +' + (11 * l) + '° d\'arc' },
      { id: 'blade_crit', name: 'Coup précis', icon: '🎯', max: 8, cost: 20, mult: 1.45, x: 0, y: 2, req: [['blade_speed', 2]],
        desc: 'Chance de coup critique. Au rang ultime, les critiques deviennent dévastateurs.',
        fx: l => l >= 8 ? '50 % de critique (dégâts ×2,6)' : Math.round(5 + 3.5 * l) + ' % de critique (dégâts ×2)' },
      { id: 'blade_deflect', name: 'Renvoi', icon: '🛡️', max: 3, cost: 35, mult: 1.8, ultCost: 5.5, x: 1, y: 2, req: [['blade_reach', 1]],
        desc: 'Le sabre renvoie les crachats d\'acide. Au rang ultime, les tirs renvoyés traquent une cible.',
        fx: l => !l ? 'Aucun renvoi' : l >= 3 ? 'Renvoi guidé vers l\'ennemi, dégâts ×7' : 'Crachats renvoyés, dégâts ×' + fmt(2 + 1.5 * (l - 1)) },
      { id: 'blade_whirl', name: 'Tourbillon', icon: '🌀', max: 3, cost: 60, mult: 1.9, ultCost: 6.0, x: 0, y: 3, req: [['blade_crit', 2]],
        desc: 'Régulièrement, le coup de sabre devient une coupe circulaire à 360° qui repousse les zombies.',
        fx: l => !l ? '—' : l >= 3 ? '1 coup sur 2 frappe à 360° (dégâts +50 %)' : '1 coup sur ' + (6 - l) + ' frappe à 360°' },
      { id: 'blade_wave', name: 'Lame d\'air', icon: '🌙', max: 8, cost: 70, mult: 1.45, x: 1, y: 3, req: [['blade_reach', 3]],
        desc: 'Chaque coup projette une lame d\'air qui traverse les zombies.',
        fx: l => !l ? '—' : l >= 8 ? '160 % des dégâts, traverse 14 zombies' : Math.round((0.28 + 0.12 * l) * 100) + ' % des dégâts, traverse ' + (1 + l) + ' zombies' },
      { id: 'blade_leech', name: 'Lame vampire', icon: '🩸', max: 5, cost: 90, mult: 1.6, x: 0, y: 4, req: [['blade_whirl', 1]],
        desc: 'Chaque zombie touché au sabre rend un peu de vie.',
        fx: l => l >= 5 ? '+2,5 PV par zombie touché (6 max par coup)' : '+' + fmt(0.28 * l) + ' PV par zombie touché (4 max)' },
      { id: 'blade_exec', name: 'Coup de grâce', icon: '💀', max: 4, cost: 110, mult: 1.7, ultCost: 5.5, x: 1, y: 4, req: [['blade_wave', 1]],
        desc: 'Achève net les zombies trop affaiblis.',
        fx: l => !l ? '—' : l >= 4 ? 'Achève sous 30 % de vie (10 % sur les Colosses)' : 'Achève sous ' + (4 + 4 * l) + ' % de vie (hors boss)' },

      // --- Ki ---
      { id: 'ki_max', name: 'Réservoir de Ki', icon: '🔷', max: 12, cost: 9, mult: 1.4, x: 2.75, y: 0,
        desc: 'Plus d\'énergie maximale pour enchaîner coups de sabre et compétences.',
        fx: l => (l >= 12 ? 480 : 100 + 22 * l) + ' d\'énergie maximale' },
      { id: 'ki_regen', name: 'Souffle', icon: '🌬️', max: 12, cost: 12, mult: 1.42, x: 2.25, y: 1, req: [['ki_max', 1]],
        desc: 'L\'énergie se recharge plus vite.',
        fx: l => fmt(l >= 12 ? 36 : 9 * (1 + 0.16 * l)) + ' énergie / seconde' },
      { id: 'ki_dash', name: 'Pas du vent', icon: '🍃', max: 4, cost: 25, mult: 1.8, ultCost: 5.5, x: 3.25, y: 1, req: [['ki_max', 1]],
        desc: 'ESPACE : bond fulgurant, invulnérable pendant le bond. Dès le niveau 3, tranche les zombies traversés.',
        fx: l => !l ? 'Non débloqué' : l >= 4 ? 'Bond de 270 px pour 18 Ki, tranche (240 % dégâts) et étourdit' : 'Bond de ' + (135 + 22 * l) + ' px pour ' + [38, 38, 34, 30][l] + ' Ki' + (l >= 3 ? ', tranche au passage' : '') },
      { id: 'ki_kill', name: 'Moisson de Ki', icon: '♻️', max: 5, cost: 26, mult: 1.52, x: 2.25, y: 2, req: [['ki_regen', 2]],
        desc: 'Chaque zombie tué rend de l\'énergie.',
        fx: l => '+' + fmt(l >= 5 ? 8 : 1.0 * l) + ' énergie par zombie tué' },
      { id: 'ki_eff', name: 'Maîtrise', icon: '☯️', max: 5, cost: 40, mult: 1.58, ultCost: 5.5, x: 2.25, y: 3, req: [['ki_kill', 1]],
        desc: 'Les coups de sabre et tous les pouvoirs coûtent moins d\'énergie.',
        fx: l => '-' + Math.round((1 - (l >= 5 ? 0.55 : Math.pow(0.92, l))) * 100) + ' % de coût en Ki (sabre et pouvoirs)' },
      { id: 'ki_ult', name: 'Tempête de lames', icon: '⚔️', max: 8, cost: 150, mult: 1.42, ultCost: 5.5, x: 2.75, y: 4, req: [['ki_eff', 2], ['ki_dash', 1]],
        desc: 'R : déluge défensif de lames à échelle humaine qui repousse violemment les zombies proches, détruit les projectiles et réduit les dégâts subis.',
        fx: l => !l ? 'Non débloqué' : l >= 8 ? '6,5 s, repousse fort, détruit les tirs, -80 % dégâts subis, ' + Math.round(0.75 * 100) + ' % dégâts / 0,1 s' : fmt(2.2 + 0.35 * l) + ' s, repousse et protège (-60 % dégâts subis), ' + Math.round((0.20 + 0.04 * l) * 100) + ' % dégâts / 0,1 s' },

      // --- Poussée ---
      { id: 'push_force', name: 'Poussée', icon: '✋', max: 8, cost: 10, mult: 1.5, x: 4.75, y: 0,
        desc: 'CLIC DROIT ou E : repousse violemment les zombies devant soi.',
        fx: l => l >= 8 ? '+220 % de puissance, recharge réduite à 1,0 s' : pc(0.18 * l) + ' de puissance' },
      { id: 'push_dmg', name: 'Impact', icon: '💥', max: 10, cost: 18, mult: 1.5, x: 4.25, y: 1, req: [['push_force', 1]],
        desc: 'La poussée blesse les zombies.',
        fx: l => (l >= 10 ? 180 : 6 + 12 * l) + ' dégâts' },
      { id: 'push_wide', name: 'Onde de choc', icon: '🔆', max: 5, cost: 30, mult: 1.6, ultCost: 5.5, x: 5.25, y: 1, req: [['push_force', 2]],
        desc: 'La poussée s\'élargit. Au rang ultime, elle explose à 360° tout autour de soi.',
        fx: l => [65, 95, 135, 180, 235, 360][l] + '° d\'ouverture' },
      { id: 'push_stun', name: 'Sonné', icon: '💫', max: 4, cost: 40, mult: 1.6, ultCost: 5.2, x: 4.25, y: 2, req: [['push_dmg', 2]],
        desc: 'Les zombies repoussés restent étourdis.',
        fx: l => !l ? '—' : l >= 4 ? '2,5 s d\'étourdissement (affecte aussi les Colosses)' : fmt(0.4 * l) + ' s d\'étourdissement' },
      { id: 'push_range', name: 'Portée', icon: '📡', max: 5, cost: 35, mult: 1.55, x: 5.25, y: 2, req: [['push_wide', 1]],
        desc: 'La poussée porte plus loin.',
        fx: l => Math.round(165 * (1 + (l >= 5 ? 0.9 : 0.12 * l))) + ' px de portée' },

      // --- Stase ---
      { id: 'stasis', name: 'Stase temporelle', icon: '⏳', max: 6, cost: 16, mult: 1.75, ultCost: 7.5, x: 6.75, y: 0,
        desc: 'F : une bulle ralentit le temps des zombies proches. Au rang ultime, le temps s\'arrête totalement dans la bulle. Recharge 9 s.',
        fx: l => !l ? 'Non débloqué' : l >= 6 ? 'ARRÊT DU TEMPS : zombies et tirs FIGÉS (100 %)' : 'Zombies ralentis de ' + Math.round([0, 0.28, 0.40, 0.52, 0.64, 0.75, 1][l] * 100) + ' %' },
      { id: 'stasis_radius', name: 'Bulle élargie', icon: '⭕', max: 6, cost: 22, mult: 1.5, x: 6.25, y: 1, req: [['stasis', 1]],
        desc: 'La bulle de stase est plus grande.',
        fx: l => Math.round(145 * (1 + (l >= 6 ? 1.0 : 0.12 * l))) + ' px de rayon' },
      { id: 'stasis_dur', name: 'Éternité', icon: '⌛', max: 6, cost: 22, mult: 1.5, x: 7.25, y: 1, req: [['stasis', 1]],
        desc: 'La stase dure plus longtemps.',
        fx: l => fmt(l >= 6 ? 9.0 : 3.5 + 0.6 * l) + ' s de stase' },
      { id: 'stasis_shatter', name: 'Bris temporel', icon: '🧊', max: 5, cost: 45, mult: 1.6, x: 6.25, y: 2, req: [['stasis_radius', 2]],
        desc: 'Les zombies pris dans la stase subissent plus de dégâts.',
        fx: l => pc(l >= 5 ? 0.8 : 0.1 * l) + ' de dégâts subis dans la bulle' },
      { id: 'stasis_drain', name: 'Temps volé', icon: '🔮', max: 4, cost: 55, mult: 1.7, ultCost: 5.2, x: 7.25, y: 2, req: [['stasis_dur', 2]],
        desc: 'Chaque zombie pris dans la bulle rend de l\'énergie.',
        fx: l => '+' + fmt(l >= 4 ? 1.8 : 0.3 * l) + ' énergie / s par zombie (30 max)' },

      // --- Corps ---
      { id: 'body_hp', name: 'Vigueur', icon: '❤️', max: 15, cost: 8, mult: 1.42, x: 8.75, y: 0,
        desc: 'Plus de points de vie.',
        fx: l => (130 + (l >= 15 ? 400 : 18 * l)) + ' PV maximum' },
      { id: 'body_speed', name: 'Agilité', icon: '👟', max: 6, cost: 15, mult: 1.5, x: 8.25, y: 1, req: [['body_hp', 1]],
        desc: 'Se déplace plus vite.',
        fx: l => pc(l >= 6 ? 0.35 : 0.04 * l) + ' de vitesse' },
      { id: 'body_armor', name: 'Peau de fer', icon: '🪨', max: 8, cost: 18, mult: 1.5, x: 9.25, y: 1, req: [['body_hp', 2]],
        desc: 'Réduit les dégâts subis.',
        fx: l => '-' + Math.round((1 - (l >= 8 ? 0.5 : Math.pow(0.95, l))) * 100) + ' % de dégâts subis' },
      { id: 'body_souls', name: 'Collecteur d\'âmes', icon: '👻', max: 8, cost: 20, mult: 1.5, x: 8.25, y: 2, req: [['body_speed', 2]],
        desc: 'Plus d\'âmes récoltées, attirées de plus loin.',
        fx: l => pc(l >= 8 ? 1.2 : 0.09 * l) + ' d\'âmes, ' + pc(l >= 8 ? 2.0 : 0.18 * l) + ' de rayon d\'attraction' },
      { id: 'body_regen', name: 'Méditation', icon: '🧘', max: 8, cost: 30, mult: 1.55, x: 9.25, y: 2, req: [['body_armor', 2]],
        desc: 'Régénère des points de vie en continu.',
        fx: l => '+' + fmt(l >= 8 ? 6.0 : 0.45 * l) + ' PV / seconde' },
      { id: 'body_dodge', name: 'Esquive', icon: '🌫️', max: 5, cost: 50, mult: 1.6, x: 10.1, y: 2, req: [['body_armor', 3]],
        desc: 'Chance d\'éviter complètement un coup.',
        fx: l => (l >= 5 ? 30 : 4 * l) + ' % d\'esquive' },
      { id: 'body_heal', name: 'Orbes de vie', icon: '💚', max: 5, cost: 35, mult: 1.55, x: 8.25, y: 3, req: [['body_souls', 1]],
        desc: 'Les zombies laissent plus souvent des orbes de soin, plus puissants.',
        fx: l => l >= 5 ? '5 % de chance, 45 PV' : fmt(1.0 + 0.5 * l) + ' % de chance, ' + (10 + 4 * l) + ' PV' },
      { id: 'body_second', name: 'Second souffle', icon: '🔥', max: 1, cost: 1100, mult: 1, x: 9.25, y: 3, req: [['body_regen', 3]],
        desc: 'Une fois par partie, revient à 100 % de vie au lieu de mourir et repousse violemment toute la horde.',
        fx: l => l ? 'Actif (100 % PV + onde de choc)' : '—' },
    ],
  },

  soldier: {
    branches: [
      { name: 'Maniement', x: 0.5 },
      { name: 'Armes', x: 2.75 },
      { name: 'Logistique', x: 5.25 },
      { name: 'Tactique', x: 7.5 },
      { name: 'Corps', x: 9.85 },
    ],
    nodes: [
      // --- Maniement : profite à TOUTES les armes ---
      { id: 'pis_dmg', name: 'Calibre', icon: '🔫', max: 20, cost: 11, mult: 1.42, x: 0.5, y: 0,
        desc: 'Toutes les armes font plus de dégâts : pistolet, pompe, fusil, lance-flammes, lance-grenades et mitrailleuse.',
        fx: l => pc(l >= 20 ? 4.0 : 0.14 * l) + ' de dégâts, toutes armes' },
      { id: 'pis_rate', name: 'Détente rapide', icon: '⚡', max: 12, cost: 18, mult: 1.45, x: 0, y: 1, req: [['pis_dmg', 2]],
        desc: 'Toutes les armes tirent plus vite. Le fusil, la mitrailleuse et le lance-flammes ont une cadence plafonnée : le surplus se change en dégâts.',
        fx: l => pc(l >= 12 ? 1.5 : 0.08 * l) + ' de cadence, toutes armes (pistolet : ' + fmt(3.8 * (1 + (l >= 12 ? 1.5 : 0.08 * l))) + ' tirs / s)' },
      { id: 'pis_crit', name: 'Tir précis', icon: '🎯', max: 8, cost: 20, mult: 1.45, x: 1, y: 1, req: [['pis_dmg', 3]],
        desc: 'Chance de coup critique, pour toutes les armes.',
        fx: l => l >= 8 ? '50 % de critique (dégâts ×2,6)' : Math.round(5 + 3.5 * l) + ' % de critique (dégâts ×2)' },
      { id: 'pis_pierce', name: 'Balles perforantes', icon: '📌', max: 3, cost: 50, mult: 1.9, ultCost: 5.5, x: 0, y: 2, req: [['pis_rate', 2]],
        desc: 'Les balles traversent davantage de zombies (pistolet, pompe, fusil, mitrailleuse) : alignez la horde dans un couloir.',
        fx: l => 'Pistolet : traverse ' + (l >= 3 ? 7 : 2 + l) + ' zombies · autres armes : +' + (l >= 3 ? 4 : l) },
      { id: 'pis_dual', name: 'Pistolets jumelés', icon: '✌️', max: 2, cost: 180, mult: 2.2, ultCost: 5.5, x: 0.5, y: 3, req: [['pis_pierce', 1], ['pis_crit', 2]],
        desc: 'Le pistolet tire plusieurs balles à la fois, et les autres armes ont une chance de tirer sans consommer de munition.',
        fx: l => (l >= 2 ? 4 : 1 + l) + ' balle' + (l ? 's' : '') + ' par tir · ' + (l >= 2 ? 50 : 20 * l) + ' % de tirs gratuits' },

      // --- Armes ---
      { id: 'w_shotgun', name: 'Fusil à pompe', icon: '💣', max: 10, cost: 20, mult: 1.38, x: 2.75, y: 0,
        desc: 'Débloque le fusil à pompe : une gerbe de plombs à courte portée. Munitions dans les caisses.',
        fx: l => !l ? 'Non débloqué' : l >= 10 ? '14 plombs, +180 % de dégâts, traverse 3 zombies' : (5 + Math.floor(l / 2)) + ' plombs, ' + pc(0.11 * (l - 1)) + ' de dégâts' },
      { id: 'w_rifle', name: 'Fusil d\'assaut', icon: '🪖', max: 10, cost: 45, mult: 1.38, x: 2.75, y: 1, req: [['w_shotgun', 1]],
        desc: 'Débloque le fusil d\'assaut : tir automatique rapide et précis.',
        fx: l => !l ? 'Non débloqué' : l >= 10 ? '+180 % de dégâts, balles perforantes' : pc(0.11 * (l - 1)) + ' de dégâts' },
      { id: 'w_flamer', name: 'Lance-flammes', icon: '🔥', max: 10, cost: 70, mult: 1.38, x: 2.25, y: 2, req: [['w_rifle', 1]],
        desc: 'Débloque le lance-flammes : un cône de feu idéal dans les goulots d\'étranglement.',
        fx: l => !l ? 'Non débloqué' : l >= 10 ? '+180 % de dégâts et brûlure, portée +35 %' : pc(0.11 * (l - 1)) + ' de dégâts et de brûlure' },
      { id: 'w_launcher', name: 'Lance-grenades', icon: '🎇', max: 10, cost: 70, mult: 1.38, x: 3.25, y: 2, req: [['w_rifle', 1]],
        desc: 'Débloque le lance-grenades : des obus qui explosent au contact.',
        fx: l => !l ? 'Non débloqué' : l >= 10 ? '+180 % de dégâts, +65 % de rayon' : pc(0.11 * (l - 1)) + ' de dégâts, ' + pc(0.05 * (l - 1)) + ' de rayon' },
      { id: 'w_minigun', name: 'Mitrailleuse lourde', icon: '🌪️', max: 10, cost: 150, mult: 1.38, x: 2.75, y: 3, req: [['w_launcher', 2], ['w_flamer', 1]],
        desc: 'Débloque la mitrailleuse : un déluge de balles, mais ralentit le déplacement (sauf au rang ultime).',
        fx: l => !l ? 'Non débloqué' : l >= 10 ? '+180 % de dégâts, aucun ralentissement' : pc(0.11 * (l - 1)) + ' de dégâts' },

      // --- Logistique ---
      { id: 'log_crate', name: 'Caisses garnies', icon: '📦', max: 12, cost: 12, mult: 1.45, x: 5.25, y: 0,
        desc: 'Chaque caisse trouvée sur le terrain contient plus de munitions.',
        fx: l => pc(l >= 12 ? 2.5 : 0.15 * l) + ' de munitions par caisse' },
      { id: 'log_start', name: 'Munitions de départ', icon: '🎒', max: 8, cost: 18, mult: 1.5, ultCost: 5.5, x: 4.5, y: 1, req: [['log_crate', 1]],
        desc: 'Commence la partie avec une petite réserve de munitions pour les armes débloquées.',
        fx: l => !l ? 'Aucune munition au départ' : (l >= 8 ? 100 : 8 * l) + ' % d\'une caisse pour chaque arme' },
      { id: 'log_freq', name: 'Ravitaillement', icon: '🪂', max: 8, cost: 16, mult: 1.45, x: 5.25, y: 1, req: [['log_crate', 1]],
        desc: 'Les caisses apparaissent plus souvent.',
        fx: l => 'Une caisse toutes les ' + fmt(l >= 8 ? 5.0 : 13 * Math.pow(0.92, l)) + ' s' },
      { id: 'log_scav', name: 'Récupérateur', icon: '🧲', max: 6, cost: 25, mult: 1.5, x: 6, y: 1, req: [['log_crate', 2]],
        desc: 'Les zombies laissent parfois tomber des chargeurs.',
        fx: l => fmt(l >= 6 ? 12 : 1.2 * l) + ' % de chance par zombie' },
      { id: 'log_cap', name: 'Sac à dos', icon: '🧳', max: 6, cost: 25, mult: 1.5, x: 4.5, y: 2, req: [['log_start', 2]],
        desc: 'Peut transporter plus de munitions maximum.',
        fx: l => pc(l >= 6 ? 2.0 : 0.25 * l) + ' de capacité' },
      { id: 'log_radar', name: 'Radar', icon: '📍', max: 1, cost: 90, mult: 1, x: 5.25, y: 2, req: [['log_freq', 1]],
        desc: 'Des flèches indiquent les caisses hors de l\'écran.',
        fx: l => l ? 'Actif' : '—' },
      { id: 'log_med', name: 'Trousse de secours', icon: '🩹', max: 5, cost: 30, mult: 1.55, x: 6, y: 2, req: [['log_freq', 2]],
        desc: 'Les caisses contiennent plus souvent des soins, plus efficaces.',
        fx: l => l >= 5 ? '65 % de chance, 80 PV' : Math.round((0.20 + 0.06 * l) * 100) + ' % de chance, ' + (25 + 8 * l) + ' PV' },
      { id: 'log_drop', name: 'Largage', icon: '✈️', max: 3, cost: 100, mult: 1.95, ultCost: 5.5, x: 5.25, y: 3, req: [['log_radar', 1]],
        desc: 'Au début de chaque vague (à partir de la 2e), des caisses sont larguées près de soi.',
        fx: l => !l ? '—' : l >= 3 ? '3 grandes caisses (×1,5) par vague' : l + ' caisse' + (l > 1 ? 's' : '') + ' par vague (dès la 2e)' },

      // --- Tactique ---
      { id: 'tac_gren', name: 'Grenades', icon: '🧨', max: 6, cost: 16, mult: 1.52, x: 7, y: 0,
        desc: 'CLIC DROIT ou E : lancer une grenade. Commence avec quelques grenades, et les caisses en contiennent.',
        fx: l => !l ? 'Non débloqué' : l >= 6 ? '5 grenades au départ, 10 maximum' : Math.ceil(l / 2) + ' grenade' + (Math.ceil(l / 2) > 1 ? 's' : '') + ' au départ, ' + (2 + l) + ' maximum' },
      { id: 'tac_roll', name: 'Roulade', icon: '🤸', max: 4, cost: 20, mult: 1.7, ultCost: 5.2, x: 8, y: 0,
        desc: 'ESPACE : roulade rapide, invulnérable pendant le mouvement.',
        fx: l => !l ? 'Non débloqué' : l >= 4 ? 'Recharge 1,2 s, distance +25 %' : 'Recharge ' + fmt(3.8 - 0.45 * l) + ' s' },
      { id: 'tac_gren_pow', name: 'Explosifs', icon: '☢️', max: 10, cost: 25, mult: 1.5, x: 7, y: 1, req: [['tac_gren', 1]],
        desc: 'Les grenades font plus de dégâts sur une plus grande zone.',
        fx: l => l >= 10 ? '+260 % de dégâts, +100 % de rayon' : pc(0.18 * l) + ' de dégâts, ' + pc(0.08 * l) + ' de rayon' },
      { id: 'tac_adren', name: 'Adrénaline', icon: '💉', max: 5, cost: 40, mult: 1.6, ultCost: 5.2, x: 8, y: 1, req: [['tac_roll', 1]],
        desc: 'F : tire 50 % plus vite et court 30 % plus vite (au rang ultime : +80 % cadence et 10 s).',
        fx: l => !l ? 'Non débloqué' : l >= 5 ? '10 s, cadence +80 %, vitesse +40 %, recharge 26 s' : fmt(3.5 + 0.8 * l) + ' s, recharge 30 s' },
      { id: 'tac_frag', name: 'Fragmentation', icon: '🎆', max: 3, cost: 80, mult: 1.8, ultCost: 5.5, x: 7, y: 2, req: [['tac_gren_pow', 3]],
        desc: 'Les grenades libèrent des bombes secondaires.',
        fx: l => !l ? '—' : (l >= 3 ? 8 : 2 + l) + ' bombes secondaires' },
      { id: 'tac_turret', name: 'Tourelle', icon: '🗼', max: 8, cost: 120, mult: 1.45, ultCost: 5.5, x: 8, y: 2, req: [['tac_adren', 2]],
        desc: 'R : déploie une tourelle automatique qui mitraille les zombies.',
        fx: l => !l ? 'Non débloqué' : l >= 8 ? '38 s, +200 % de dégâts, cadence ×1,6, recharge 35 s' : fmt(14 + 2.5 * l) + ' s, ' + pc(0.18 * (l - 1)) + ' de dégâts, recharge 40 s' },

      // --- Corps ---
      { id: 'body_hp', name: 'Endurance', icon: '❤️', max: 15, cost: 8, mult: 1.42, x: 9.75, y: 0,
        desc: 'Plus de points de vie.',
        fx: l => (120 + (l >= 15 ? 400 : 18 * l)) + ' PV maximum' },
      { id: 'body_speed', name: 'Entraînement', icon: '👟', max: 6, cost: 15, mult: 1.5, x: 9.25, y: 1, req: [['body_hp', 1]],
        desc: 'Se déplace plus vite.',
        fx: l => pc(l >= 6 ? 0.35 : 0.04 * l) + ' de vitesse' },
      { id: 'body_armor', name: 'Gilet pare-balles', icon: '🦺', max: 8, cost: 18, mult: 1.5, x: 10.25, y: 1, req: [['body_hp', 2]],
        desc: 'Réduit les dégâts subis.',
        fx: l => '-' + Math.round((1 - (l >= 8 ? 0.5 : Math.pow(0.95, l))) * 100) + ' % de dégâts subis' },
      { id: 'body_souls', name: 'Chasseur de primes', icon: '👻', max: 8, cost: 20, mult: 1.5, x: 9.25, y: 2, req: [['body_speed', 2]],
        desc: 'Plus d\'âmes récoltées, attirées de plus loin.',
        fx: l => pc(l >= 8 ? 1.2 : 0.09 * l) + ' d\'âmes, ' + pc(l >= 8 ? 2.0 : 0.18 * l) + ' de rayon d\'attraction' },
      { id: 'body_regen', name: 'Bandages', icon: '🩼', max: 8, cost: 30, mult: 1.55, x: 10.25, y: 2, req: [['body_armor', 2]],
        desc: 'Régénère des points de vie en continu.',
        fx: l => '+' + fmt(l >= 8 ? 5.0 : 0.38 * l) + ' PV / seconde' },
      { id: 'body_dodge', name: 'Réflexes', icon: '🌫️', max: 5, cost: 50, mult: 1.6, x: 11.1, y: 2, req: [['body_armor', 3]],
        desc: 'Chance d\'éviter complètement un coup.',
        fx: l => (l >= 5 ? 30 : 4 * l) + ' % d\'esquive' },
      { id: 'body_second', name: 'Second souffle', icon: '🔥', max: 1, cost: 1100, mult: 1, x: 10.25, y: 3, req: [['body_regen', 3]],
        desc: 'Une fois par partie, revient à 100 % de vie au lieu de mourir et repousse violemment toute la horde.',
        fx: l => l ? 'Actif (100 % PV + onde de choc)' : '—' },
    ],
  },
};

for (const k in TREES) {
  TREES[k].byId = {};
  // coûts exponentiels : chaque niveau coûte nettement plus que le précédent
  // et les compétences profondes (plus bas dans l'arbre) coûtent plus cher
  for (const n of TREES[k].nodes) { if (n.mult > 1) n.mult += 0.18; n.cost = Math.round(n.cost * (1 + 1.2 * Math.floor(n.y))); }
  for (const n of TREES[k].nodes) TREES[k].byId[n.id] = n;
}

function nodeCost(node, lvl) {
  let c = node.cost * Math.pow(node.mult, lvl);
  // Le dernier rang d'une compétence demande énormément plus de points
  if (node.max > 1 && lvl === node.max - 1) {
    c *= node.ultCost || 4.8;
  }
  return Math.round(c);
}

/* ------------------------------------------------------------------ */
/* Classes et statistiques                                              */
/* ------------------------------------------------------------------ */

const WEAPON_ORDER = ['pistol', 'shotgun', 'rifle', 'flamer', 'launcher', 'minigun'];
const WEAPON_NAMES = {
  pistol: 'Pistolet', shotgun: 'Pompe', rifle: 'Fusil', flamer: 'Flammes', launcher: 'Lance-gr.', minigun: 'Mitrailleuse',
};

const CLASSES = {
  samurai: {
    name: 'Le Rōnin', tagline: 'Sabre, Ki et maîtrise du temps',
    desc: 'Combat au sabre au corps à corps. Chaque coup de sabre et chaque pouvoir consomme du Ki : améliorer sa réserve et sa régénération d\'énergie est vital pour survivre.',
    color: '#7cc8ff',
  },
  soldier: {
    name: 'Le Soldat', tagline: 'Pistolet illimité, le reste se ramasse',
    desc: 'Son pistolet ne manque jamais de balles. Toutes les autres armes — pompe, fusil, lance-flammes, lance-grenades, mitrailleuse — s\'alimentent avec les caisses trouvées dans les ruines.',
    color: '#ffb35c',
  },
};

function computeStats(cls, levels) {
  const L = id => levels[id] || 0;
  const s = { cls };
  const common = () => {
    s.dmgTaken = L('body_armor') >= 8 ? 0.5 : Math.pow(0.95, L('body_armor'));
    s.soulMult = 1 + (L('body_souls') >= 8 ? 1.2 : 0.09 * L('body_souls'));
    s.magnet = 120 * (1 + (L('body_souls') >= 8 ? 2.0 : 0.18 * L('body_souls')));
    s.dodge = L('body_dodge') >= 5 ? 0.30 : 0.04 * L('body_dodge');
    s.second = L('body_second') > 0;
  };
  if (cls === 'samurai') {
    common();
    s.maxHp = 130 + (L('body_hp') >= 15 ? 400 : 18 * L('body_hp'));
    s.speed = 195 * (1 + (L('body_speed') >= 6 ? 0.35 : 0.04 * L('body_speed')));
    s.regen = L('body_regen') >= 8 ? 6.0 : 0.45 * L('body_regen');
    s.healChance = L('body_heal') >= 5 ? 0.05 : 0.01 + 0.005 * L('body_heal');
    s.healAmt = L('body_heal') >= 5 ? 45 : 10 + 4 * L('body_heal');

    s.swordDmg = 28 * (1 + (L('blade_dmg') >= 20 ? 4.0 : 0.14 * L('blade_dmg')));
    s.swordCd = 0.38 * (L('blade_speed') >= 8 ? 0.44 : Math.pow(0.93, L('blade_speed')));
    s.swordRange = 80 * (1 + (L('blade_reach') >= 5 ? 0.65 : 0.08 * L('blade_reach')));
    s.swordArc = (110 + (L('blade_reach') >= 5 ? 85 : 11 * L('blade_reach'))) * DEG;
    s.crit = L('blade_crit') >= 8 ? 0.50 : 0.05 + 0.035 * L('blade_crit');
    s.critMult = L('blade_crit') >= 8 ? 2.6 : 2;
    s.deflect = L('blade_deflect');
    s.whirlEvery = L('blade_whirl') ? (L('blade_whirl') >= 3 ? 2 : 6 - L('blade_whirl')) : 0;
    s.whirlMult = L('blade_whirl') >= 3 ? 1.5 : 1.25;
    s.airWave = L('blade_wave') ? {
      dmg: L('blade_wave') >= 8 ? 1.6 : 0.28 + 0.12 * L('blade_wave'),
      pierce: L('blade_wave') >= 8 ? 14 : 1 + L('blade_wave'),
      big: L('blade_wave') >= 8,
    } : null;
    s.leech = L('blade_leech') >= 5 ? 2.5 : 0.28 * L('blade_leech');
    s.leechCap = L('blade_leech') >= 5 ? 6 : 4;
    s.execute = L('blade_exec') ? (L('blade_exec') >= 4 ? 0.30 : (4 + 4 * L('blade_exec')) / 100) : 0;
    s.executeBoss = L('blade_exec') >= 4 ? 0.10 : 0;

    s.energyMax = L('ki_max') >= 12 ? 480 : 100 + 22 * L('ki_max');
    s.energyRegen = L('ki_regen') >= 12 ? 36 : 9 * (1 + 0.16 * L('ki_regen'));
    s.energyOnKill = L('ki_kill') >= 5 ? 8 : 1.0 * L('ki_kill');
    s.costMult = L('ki_eff') >= 5 ? 0.55 : Math.pow(0.92, L('ki_eff'));
    s.swordCost = 7 * s.costMult;
    s.dash = L('ki_dash') ? {
      cost: [0, 38, 34, 30, 18][L('ki_dash')] * s.costMult,
      dist: L('ki_dash') >= 4 ? 270 : 135 + 22 * L('ki_dash'),
      cut: L('ki_dash') >= 4 ? 2.4 : L('ki_dash') >= 3 ? 1.0 : 0,
      stun: L('ki_dash') >= 4 ? 1.2 : 0,
    } : null;
    s.ult = L('ki_ult') ? {
      cost: 80 * s.costMult,
      cd: 8,
      dur: L('ki_ult') >= 8 ? 6.5 : 2.2 + 0.35 * L('ki_ult'),
      mult: L('ki_ult') >= 8 ? 0.75 : 0.20 + 0.04 * L('ki_ult'),
      radius: L('ki_ult') >= 8 ? 88 : 76,
      kb: L('ki_ult') >= 8 ? 520 : 260 + 25 * L('ki_ult'),
      dmgTakenMult: L('ki_ult') >= 8 ? 0.20 : 0.40,
    } : null;

    s.push = {
      cost: 35 * s.costMult,
      cd: L('push_force') >= 8 ? 1.0 : 1.6,
      arc: [65, 95, 135, 180, 235, 360][L('push_wide')] * DEG,
      range: 165 * (1 + (L('push_range') >= 5 ? 0.9 : 0.12 * L('push_range'))),
      force: 560 * (1 + (L('push_force') >= 8 ? 2.2 : 0.18 * L('push_force'))),
      dmg: L('push_dmg') >= 10 ? 180 : 6 + 12 * L('push_dmg'),
      stun: L('push_stun') >= 4 ? 2.5 : 0.4 * L('push_stun'),
      stunBoss: L('push_stun') >= 4,
    };
    s.stasis = L('stasis') ? {
      cost: 65 * s.costMult,
      cd: 9,
      slow: [0, 0.28, 0.40, 0.52, 0.64, 0.75, 1][L('stasis')],
      radius: 145 * (1 + (L('stasis_radius') >= 6 ? 1.0 : 0.12 * L('stasis_radius'))),
      dur: L('stasis_dur') >= 6 ? 9.0 : 3.5 + 0.6 * L('stasis_dur'),
      vuln: L('stasis_shatter') >= 5 ? 0.8 : 0.1 * L('stasis_shatter'),
      drain: L('stasis_drain') >= 4 ? 1.8 : 0.3 * L('stasis_drain'),
    } : null;
  } else {
    common();
    s.maxHp = 120 + (L('body_hp') >= 15 ? 400 : 18 * L('body_hp'));
    s.speed = 190 * (1 + (L('body_speed') >= 6 ? 0.35 : 0.04 * L('body_speed')));
    s.regen = L('body_regen') >= 8 ? 5.0 : 0.38 * L('body_regen');
    s.healChance = 0.01;
    s.healAmt = 15;
    s.crit = L('pis_crit') >= 8 ? 0.50 : 0.05 + 0.035 * L('pis_crit');
    s.critMult = L('pis_crit') >= 8 ? 2.6 : 2;

    const wl = id => {
      const l = L(id);
      if (!l) return 0;
      return l >= 10 ? 2.8 : 1 + 0.11 * (l - 1);
    };
    const crateMult = 1 + (L('log_crate') >= 12 ? 2.5 : 0.15 * L('log_crate'));
    const capMult = 1 + (L('log_cap') >= 6 ? 2.0 : 0.25 * L('log_cap'));
    const startFrac = L('log_start') >= 8 ? 1.0 : 0.08 * L('log_start');
    const W = {};
    W.pistol = {
      unlocked: true,
      dmg: 24 * (1 + (L('pis_dmg') >= 20 ? 4.0 : 0.14 * L('pis_dmg'))),
      rate: 3.8 * (1 + (L('pis_rate') >= 12 ? 1.5 : 0.08 * L('pis_rate'))),
      spread: 0.04, speed: 980, range: 620,
      pierce: L('pis_pierce') >= 3 ? 7 : 2 + L('pis_pierce'),
      count: L('pis_dual') >= 2 ? 4 : 1 + L('pis_dual'),
      infinite: true,
    };
    W.shotgun = {
      unlocked: !!L('w_shotgun'),
      dmg: 16 * wl('w_shotgun'),
      rate: 1.25,
      pellets: L('w_shotgun') >= 10 ? 14 : 5 + Math.floor(L('w_shotgun') / 2),
      spread: 0.5, speed: 860, range: 360,
      pierce: L('w_shotgun') >= 10 ? 3 : 2,
      crate: 16,
    };
    W.rifle = {
      unlocked: !!L('w_rifle'),
      dmg: 17 * wl('w_rifle'),
      rate: 9.2, spread: 0.07, speed: 1100, range: 720,
      pierce: L('w_rifle') >= 10 ? 3 : 1,
      crate: 90,
    };
    W.flamer = {
      unlocked: !!L('w_flamer'),
      dmg: 7 * wl('w_flamer'),
      rate: 18,
      range: L('w_flamer') >= 10 ? 270 : 200,
      arc: 0.55,
      burn: 9 * wl('w_flamer'),
      crate: 150,
    };
    W.launcher = {
      unlocked: !!L('w_launcher'),
      dmg: 75 * wl('w_launcher'),
      radius: 95 * (1 + (L('w_launcher') >= 10 ? 0.65 : 0.05 * Math.max(0, L('w_launcher') - 1))),
      rate: 1.25, speed: 620, range: 520,
      crate: 9,
    };
    W.minigun = {
      unlocked: !!L('w_minigun'),
      dmg: 15 * wl('w_minigun'),
      rate: 22, spread: 0.16, speed: 1100, range: 680, pierce: 1,
      crate: 260,
      slow: L('w_minigun') >= 10 ? 1.0 : 0.62,
    };
    // Branche Maniement : dégâts, cadence, perforation et économie pour TOUTES les armes.
    // Fusil, mitrailleuse et lance-flammes ont une cadence plafonnée : au-delà, le bonus devient des dégâts
    // (le jeu reste fluide et le coop n'est pas noyé sous les tirs).
    const allDmg = 1 + (L('pis_dmg') >= 20 ? 4.0 : 0.14 * L('pis_dmg'));
    const allRate = 1 + (L('pis_rate') >= 12 ? 1.5 : 0.08 * L('pis_rate'));
    const allPierce = L('pis_pierce') >= 3 ? 4 : L('pis_pierce');
    const thrift = L('pis_dual') >= 2 ? 0.5 : 0.2 * L('pis_dual');
    const RATE_CAP = { rifle: 13, minigun: 28, flamer: 18 };
    for (const k of WEAPON_ORDER) {
      const w = W[k];
      if (w.infinite) continue;
      let gain = allDmg, rate = w.rate * allRate;
      if (RATE_CAP[k] && rate > RATE_CAP[k]) { gain *= rate / RATE_CAP[k]; rate = RATE_CAP[k]; }
      w.rate = rate;
      w.dmg *= gain;
      if (w.burn) w.burn *= gain;
      if (w.pierce) w.pierce += allPierce;
      w.thrift = thrift;
      const baseCrate = w.crate;
      w.crate = Math.max(1, Math.round(baseCrate * crateMult));
      w.cap = Math.max(w.crate, Math.round(w.crate * 2.5 * capMult));
      // Les munitions de départ se basent sur la caisse de base (avec un léger bonus de log_crate)
      // pour éviter de démarrer la partie avec le sac plein.
      const startPool = baseCrate * (1 + 0.05 * L('log_crate'));
      w.start = (w.unlocked && L('log_start') > 0) ? Math.max(1, Math.round(startPool * startFrac)) : 0;
      w.start = Math.min(w.start, w.cap);
    }
    s.weapons = W;
    s.crateInterval = L('log_freq') >= 8 ? 5.0 : 13 * Math.pow(0.92, L('log_freq'));
    s.radar = L('log_radar') > 0;
    s.scavenge = L('log_scav') >= 6 ? 0.12 : 0.012 * L('log_scav');
    s.medChance = L('log_med') >= 5 ? 0.65 : 0.20 + 0.06 * L('log_med');
    s.medHeal = L('log_med') >= 5 ? 80 : 25 + 8 * L('log_med');
    s.waveDrop = L('log_drop');
    s.grenades = L('tac_gren') ? {
      start: L('tac_gren') >= 6 ? 5 : Math.ceil(L('tac_gren') / 2),
      max: L('tac_gren') >= 6 ? 10 : 2 + L('tac_gren'),
      dmg: 95 * (1 + (L('tac_gren_pow') >= 10 ? 2.6 : 0.18 * L('tac_gren_pow'))),
      radius: 115 * (1 + (L('tac_gren_pow') >= 10 ? 1.0 : 0.08 * L('tac_gren_pow'))),
      frag: L('tac_frag') ? (L('tac_frag') >= 3 ? 8 : 2 + L('tac_frag')) : 0,
    } : null;
    s.roll = L('tac_roll') ? {
      cd: L('tac_roll') >= 4 ? 1.2 : 3.8 - 0.45 * L('tac_roll'),
      dist: L('tac_roll') >= 4 ? 200 : 160,
    } : null;
    s.adren = L('tac_adren') ? {
      cd: L('tac_adren') >= 5 ? 26 : 30,
      dur: L('tac_adren') >= 5 ? 10 : 3.5 + 0.8 * L('tac_adren'),
      rateMult: L('tac_adren') >= 5 ? 1.8 : 1.5,
      speedMult: L('tac_adren') >= 5 ? 1.4 : 1.3,
    } : null;
    s.turret = L('tac_turret') ? {
      cd: L('tac_turret') >= 8 ? 35 : 40,
      dur: L('tac_turret') >= 8 ? 38 : 14 + 2.5 * L('tac_turret'),
      dmg: 16 * (1 + (L('tac_turret') >= 8 ? 2.0 : 0.18 * (L('tac_turret') - 1))),
      rate: L('tac_turret') >= 8 ? 11.2 : 7,
    } : null;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Zombies et vagues                                                    */
/* ------------------------------------------------------------------ */

const ZTYPES = {
  walker:  { name: 'Rôdeur', hp: 30, speed: [58, 86], r: 14, dmg: 9, atkCd: 0.85, souls: 0.14, xp: 1, mass: 1 },
  crawler: { name: 'Rampant', hp: 10, speed: [98, 126], r: 9, dmg: 3, atkCd: 0.7, souls: 0.06, xp: 0.4, mass: 0.4 },
  runner:  { name: 'Coureur', hp: 20, speed: [116, 138], r: 12, dmg: 6, atkCd: 0.8, souls: 0.3, xp: 1.5, mass: 0.8 },
  boomer:  { name: 'Gonflé', hp: 45, speed: [48, 60], r: 18, dmg: 0, atkCd: 1.0, souls: 0.5, xp: 2, mass: 1.6, explode: { dmg: 26, r: 95 } },
  brute:   { name: 'Brute', hp: 200, speed: [46, 56], r: 22, dmg: 18, atkCd: 1.2, souls: 2, xp: 8, mass: 4 },
  spitter: { name: 'Cracheur', hp: 34, speed: [56, 66], r: 13, dmg: 4, atkCd: 1.0, souls: 0.7, xp: 3, mass: 0.9,
    ranged: { dmg: 10, range: 330, keep: 200, cd: 2.6, speed: 280 } },
  boss:    { name: 'Colosse', hp: 3200, speed: [62, 62], r: 36, dmg: 32, atkCd: 1.3, souls: 80, xp: 150, mass: 30, boss: true },
};
const ZKEYS = Object.keys(ZTYPES);

/* La horde : le nombre explose, pas la vitesse. À deux, la marée est plus dense. */
function waveTotal(n, players = 1) {
  return Math.round((90 + 45 * n + 4 * n * n) * (players > 1 ? 1.6 : 1));
}
function waveHpScale(n) { return 1 + 0.08 * (n - 1) + 0.008 * (n - 1) * (n - 1); }
function waveDmgScale(n) { return 1 + 0.05 * (n - 1) + 0.003 * (n - 1) * (n - 1); }
/* Durée maximale d'une vague : passé ce délai, la suivante déferle même si la précédente n'est pas nettoyée. */
function waveTimer(n) { return 55 + Math.min(45, 2.5 * n); }

function waveMix(n) {
  return {
    runner: n >= 4 ? Math.min(0.14, 0.025 * (n - 3)) : 0,
    boomer: n >= 5 ? Math.min(0.07, 0.014 * (n - 4)) : 0,
    brute: n >= 7 ? Math.min(0.06, 0.010 * (n - 6)) : 0,
    spitter: n >= 9 ? Math.min(0.07, 0.012 * (n - 8)) : 0,
  };
}
/* Part des meutes de Rampants (elles arrivent en bloc). */
function crawlerShare(n) { return n >= 3 ? Math.min(0.3, 0.07 * (n - 2)) : 0; }

function pickZombieType(n, rnd) {
  const mix = waveMix(n);
  let r = rnd;
  for (const k in mix) {
    if (r < mix[k]) return k;
    r -= mix[k];
  }
  return 'walker';
}

/* Niveaux gagnés pendant une partie (partagés par l'équipe). */
function xpNeed(level) { return Math.round(30 + 22 * level + 3 * level * level); }
function levelDmg(level) { return 1 + 0.06 * (level - 1); }
function levelHp(level) { return 1 + 0.03 * (level - 1); }
