/*
  Exercices structuraux de Français (CE1/CE2, CM1, CM2) — utilisés par le
  Mode Assisté (phase "Exercice structural") : l'enseignant choisit un
  exercice dans une liste, selon sa classe, au lieu de l'écrire lui-même.

  Source : fichier « Exercices_structuraux_CE1_CM2_FicheProBot.pdf »
  (50 exercices : 25 pour CE1/CE2 répartis sur les unités 1 à 12, 12 pour
  le CM1 et 13 pour le CM2, ces deux derniers sans découpage par unité).

  Format de chaque entrée de RAW :
    [groupe, unité (null si pas d'unité), n° de l'exercice, titre,
     'E' (colonne « Entrées ») ou 'Q' (colonne « Questions») pour les
     phases introductive et de systématisation,
     phase introductive, phase de systématisation, phase d'application]
  Chaque ligne d'une phase = une ligne de tableau, colonnes séparées par « | ».
    - phases introductive / systématisation : « entrée | réponse »
    - phase d'application : « entrée (enseignant) | question (élève 1) | réponse (élève 2) »

  Le fichier compile ces données en textes prêts à être placés dans les
  champs « Consignes » de la fiche : une ligne contenant « | » est rendue
  en tableau à colonnes par renderFicheFieldHtml() (1re ligne = en-têtes).
*/
(function(){
  const RAW = [
    /* ===================== CE1 / CE2 ===================== */
    ['CE', 1, 1, `Emploi de « ce… cette… »`, 'E',
`Le cahier que voici | Ce cahier
La gomme que voici | Cette gomme
Le livre que voici | Ce livre`,
`Le stylo que voici | Ce stylo
La règle que voici | Cette règle
La table que voici | Cette table
Le sac que voici | Ce sac`,
`banc | Le banc que voici | Ce banc
craie | La craie que voici | Cette craie
livre | Le livre que voici | Ce livre
porte | La porte que voici | Cette porte
tableau | Le tableau que voici | Ce tableau
chaise | La chaise que voici | Cette chaise`],

    ['CE', 1, 2, `Emploi de « cet… cette… »`, 'E',
`L'arbre que voici | Cet arbre
L'ardoise que voici | Cette ardoise
L'ami que voici | Cet ami`,
`L'élève que voici | Cet élève
L'orange que voici | Cette orange
L'homme que voici | Cet homme
L'infirmière que voici | Cette infirmière`,
`oiseau | L'oiseau que voici | Cet oiseau
école | L'école que voici | Cette école
enfant | L'enfant que voici | Cet enfant
assiette | L'assiette que voici | Cette assiette
animal | L'animal que voici | Cet animal
église | L'église que voici | Cette église`],

    ['CE', 2, 3, `Emploi de « ces »`, 'E',
`Les cahiers que voici | Ces cahiers
Les gommes que voici | Ces gommes
Les livres que voici | Ces livres`,
`Les crayons que voici | Ces crayons
Les ardoises que voici | Ces ardoises
Les chaises que voici | Ces chaises
Les craies que voici | Ces craies`,
`livres | Les livres que voici | Ces livres
bancs | Les bancs que voici | Ces bancs
cartes | Les cartes que voici | Ces cartes
sacs | Les sacs que voici | Ces sacs
tables | Les tables que voici | Ces tables
règles | Les règles que voici | Ces règles`],

    ['CE', 2, 4, `Emploi de « un, une, des »`, 'E',
`infirmier | Voici un infirmier
sage-femme | Voici une sage-femme
commerçante | Voici une commerçante`,
`maître | Voici un maître
élèves | Voici des élèves
directeur | Voici un directeur
enseignants | Voici des enseignants`,
`médecin | Qui voici ? | Voici un médecin
couturière | Qui voici ? | Voici une couturière
commerçants | Qui voici ? | Voici des commerçants
infirmière | Qui voici ? | Voici une infirmière
directrice | Qui voici ? | Voici une directrice
filles | Qui voici ? | Voici des filles`],

    ['CE', 3, 5, `Emploi de « le, la, les… de… »`, 'E',
`Un bic, Paul | Le bic de Paul
Une gomme, Sara | La gomme de Sara
Un livre, Awa | Le livre d'Awa`,
`Un cahier, Codjo | Le cahier de Codjo
Des ardoises, Bio | Les ardoises de Bio
Une craie, le maître | La craie du maître
Des cahiers, Sara | Les cahiers de Sara`,
`un crayon, Paul | Un crayon, Paul | Le crayon de Paul
une règle, Sara | Une règle, Sara | La règle de Sara
des livres, Bio | Des livres, Bio | Les livres de Bio
un sac, Codjo | Un sac, Codjo | Le sac de Codjo
une chemise, Awa | Une chemise, Awa | La chemise d'Awa
des crayons, Paul | Des crayons, Paul | Les crayons de Paul`],

    ['CE', 3, 6, `Emploi de « va au, va à la, va à l' »`, 'Q',
`Où va Dossou ? (marché) | Il va au marché
Où va Awa ? (maison) | Elle va à la maison
Où va Paul ? (église) | Il va à l'église`,
`Où va le maître ? (école) | Il va à l'école
Où va l'infirmier ? (centre de santé) | Il va au centre de santé
Où va la maîtresse ? (bibliothèque) | Elle va à la bibliothèque
Où va le médecin ? (hôpital) | Il va à l'hôpital`,
`Paul – église | Où va Paul ? | Il va à l'église
Sara – cuisine | Où va Sara ? | Elle va à la cuisine
Codjo – champ | Où va Codjo ? | Il va au champ
Awa – marché | Où va Awa ? | Elle va au marché
Bio – centre de santé | Où va Bio ? | Il va au centre de santé
Finagnon – cantine | Où va Finagnon ? | Il va à la cantine`],

    ['CE', 4, 7, `Emploi de « du, de la, de l', des »`, 'Q',
`Qu'est-ce que tu manges ? (pain) | Je mange du pain
Qu'est-ce que tu manges ? (viande) | Je mange de la viande
Qu'est-ce que tu bois ? (eau) | Je bois de l'eau`,
`Qu'est-ce que tu achètes ? (riz) | J'achète du riz
Qu'est-ce que tu vends ? (ignames) | Je vends des ignames
Qu'est-ce que tu achètes ? (savon) | J'achète du savon
Qu'est-ce que tu vends ? (mangues) | Je vends des mangues`,
`manger – poisson | Qu'est-ce que tu manges ? | Je mange du poisson
acheter – huile | Qu'est-ce que tu achètes ? | J'achète de l'huile
vendre – farine | Qu'est-ce que tu vends ? | Je vends de la farine
manger – haricots | Qu'est-ce que tu manges ? | Je mange des haricots
boire – lait | Qu'est-ce que tu bois ? | Je bois du lait
acheter – sucre | Qu'est-ce que tu achètes ? | J'achète du sucre`],

    ['CE', 4, 8, `Emploi de « as-tu un, une, des… » → « je n'ai pas de… »`, 'Q',
`As-tu un cahier ? | Non, je n'ai pas de cahier
As-tu une gomme ? | Non, je n'ai pas de gomme
As-tu un ballon ? | Non, je n'ai pas de ballon`,
`As-tu un stylo ? | Non, je n'ai pas de stylo
As-tu des crayons ? | Non, je n'ai pas de crayons
As-tu une craie ? | Non, je n'ai pas de craie
As-tu des cahiers ? | Non, je n'ai pas de cahiers`,
`un livre | As-tu un livre ? | Non, je n'ai pas de livre
une règle | As-tu une règle ? | Non, je n'ai pas de règle
des billes | As-tu des billes ? | Non, je n'ai pas de billes
un sac | As-tu un sac ? | Non, je n'ai pas de sac
un crayon | As-tu un crayon ? | Non, je n'ai pas de crayon
une robe | As-tu une robe ? | Non, je n'ai pas de robe`],

    ['CE', 5, 9, `Emploi de « il – elle »`, 'Q',
`Dossou mange ? | Oui, il mange
Baké achète ? | Oui, elle achète
Awa chante ? | Oui, elle chante`,
`Dossou vend ? | Oui, il vend
Baké lit ? | Oui, elle lit
Codjo court ? | Oui, il court
Sara joue ? | Oui, elle joue`,
`Paul – écrire | Paul écrit ? | Oui, il écrit
Sara – chanter | Sara chante ? | Oui, elle chante
Codjo – danser | Codjo danse ? | Oui, il danse
Awa – cuisiner | Awa cuisine ? | Oui, elle cuisine
Bio – manger | Bio mange ? | Oui, il mange
Pauline – lire | Pauline lit ? | Oui, elle lit`],

    ['CE', 5, 10, `Emploi de « c'est mon… c'est ton… c'est son… »`, 'E',
`Ce bic est à moi | C'est mon bic
Ce bic est à toi | C'est ton bic
Ce bic est à lui / à elle | C'est son bic
Ce cahier est à toi | C'est ton cahier`,
`Ce cahier est à moi | C'est mon cahier
Ce livre est à toi | C'est ton livre
Ce crayon est à Paul | C'est son crayon
Ce sac est à moi | C'est mon sac
Ce ballon est à Awa | C'est son ballon`,
`stylo – moi | Ce stylo est à moi | C'est mon stylo
sac – toi | Ce sac est à toi | C'est ton sac
ballon – lui | Ce ballon est à lui | C'est son ballon
banc – elle | Ce banc est à elle | C'est son banc
livre – moi | Ce livre est à moi | C'est mon livre
crayon – Sara | Ce crayon est à Sara | C'est son crayon`],

    ['CE', 6, 11, `Emploi de « c'est ma… c'est ta… c'est sa… »`, 'E',
`Cette robe est à moi | C'est ma robe
Cette robe est à toi | C'est ta robe
Cette robe est à Sara | C'est sa robe
Cette craie est à moi | C'est ma craie`,
`Cette gomme est à moi | C'est ma gomme
Cette règle est à toi | C'est ta règle
Cette natte est à Awa | C'est sa natte
Cette bille est à moi | C'est ma bille
Cette gomme est à Paul | C'est sa gomme`,
`chemise – moi | Cette chemise est à moi | C'est ma chemise
casquette – toi | Cette casquette est à toi | C'est ta casquette
bille – Paul | Cette bille est à Paul | C'est sa bille
craie – Sara | Cette craie est à Sara | C'est sa craie
robe – toi | Cette robe est à toi | C'est ta robe
règle – Awa | Cette règle est à Awa | C'est sa règle`],

    ['CE', 6, 12, `Emploi de « ce sont mes… ce sont tes… ce sont ses… »`, 'E',
`Ces cahiers sont à moi | Ce sont mes cahiers
Ces cahiers sont à toi | Ce sont tes cahiers
Ces cahiers sont à Paul | Ce sont ses cahiers
Ces livres sont à moi | Ce sont mes livres`,
`Ces stylos sont à moi | Ce sont mes stylos
Ces billes sont à toi | Ce sont tes billes
Ces livres sont à Sara | Ce sont ses livres
Ces crayons sont à toi | Ce sont tes crayons
Ces billes sont à Paul | Ce sont ses billes`,
`crayons – moi | Ces crayons sont à moi | Ce sont mes crayons
sandales – toi | Ces sandales sont à toi | Ce sont tes sandales
habits – Awa | Ces habits sont à Awa | Ce sont ses habits
sacs – Paul | Ces sacs sont à Paul | Ce sont ses sacs
cahiers – moi | Ces cahiers sont à moi | Ce sont mes cahiers
livres – toi | Ces livres sont à toi | Ce sont tes livres`],

    ['CE', 7, 13, `Emploi de « notre – votre – leur »`, 'E',
`Ce cahier est à nous | C'est notre cahier
Cette règle est à nous | C'est notre règle
Ce livre est à nous | C'est notre livre`,
`Ce livre est à vous | C'est votre livre
Cette ardoise est à vous | C'est votre ardoise
Ce ballon est à Bio et Codjo | C'est leur ballon
Cette maison est à Baké et Dossi | C'est leur maison
Cette craie est à vous | C'est votre craie
Ce champ est à Awa et Paul | C'est leur champ`,
`classe – nous | Cette classe est à nous | C'est notre classe
sac – vous | Ce sac est à vous | C'est votre sac
champ – Paul et Sara | Ce champ est à Paul et Sara | C'est leur champ
table – nous | Cette table est à nous | C'est notre table
maison – vous | Cette maison est à vous | C'est votre maison
ballon – nous | Ce ballon est à nous | C'est notre ballon`],

    ['CE', 8, 14, `Emploi de « nos – vos – leurs »`, 'E',
`Ces cahiers sont à nous | Ce sont nos cahiers
Ces livres sont à vous | Ce sont vos livres
Ces cahiers sont à vous | Ce sont vos cahiers`,
`Ces stylos sont à eux | Ce sont leurs stylos
Ces robes sont à elles | Ce sont leurs robes
Ces sacs sont à eux | Ce sont leurs sacs
Ces stylos sont à nous | Ce sont nos stylos`,
`bancs – nous | Ces bancs sont à nous | Ce sont nos bancs
sacs – vous | Ces sacs sont à vous | Ce sont vos sacs
ballons – eux | Ces ballons sont à eux | Ce sont leurs ballons
pagnes – elles | Ces pagnes sont à elles | Ce sont leurs pagnes
livres – nous | Ces livres sont à nous | Ce sont nos livres
robes – vous | Ces robes sont à vous | Ce sont vos robes`],

    ['CE', 8, 15, `Emploi du pronom personnel « lui – leur »`, 'E',
`Je donne le cahier à Finagnon | Je lui donne le cahier
Je donne la craie à Pauline | Je lui donne la craie
Je donne la gomme à Sara | Je lui donne la gomme`,
`Je donne le ballon à mes amis | Je leur donne le ballon
Je remets les cahiers aux filles | Je leur remets les cahiers
Je donne les livres aux élèves | Je leur donne les livres
Je remets le cahier à Awa | Je lui remets le cahier`,
`donner – livre – Paul | Je donne le livre à Paul | Je lui donne le livre
remettre – copies – élèves | Je remets les copies aux élèves | Je leur remets les copies
donner – bille – Awa | Je donne la bille à Awa | Je lui donne la bille
donner – craies – garçons | Je donne les craies aux garçons | Je leur donne les craies
remettre – cahier – Paul | Je remets le cahier à Paul | Je lui remets le cahier
donner – ballons – filles | Je donne les ballons aux filles | Je leur donne les ballons`],

    ['CE', 9, 16, `Emploi de « encore de, du, des, d' » → « plus de »`, 'Q',
`As-tu encore des oranges ? | Non, je n'ai plus d'oranges
As-tu encore du lait ? | Non, je n'ai plus de lait
As-tu encore des bananes ? | Non, je n'ai plus de bananes`,
`As-tu encore d'igname ? | Non, je n'ai plus d'igname
As-tu encore du riz ? | Non, je n'ai plus de riz
As-tu encore de l'eau ? | Non, je n'ai plus d'eau
As-tu encore de la viande ? | Non, je n'ai plus de viande`,
`mangues | As-tu encore des mangues ? | Non, je n'ai plus de mangues
huile | As-tu encore de l'huile ? | Non, je n'ai plus d'huile
farine | As-tu encore de la farine ? | Non, je n'ai plus de farine
pain | As-tu encore du pain ? | Non, je n'ai plus de pain
sucre | As-tu encore du sucre ? | Non, je n'ai plus de sucre
œufs | As-tu encore des œufs ? | Non, je n'ai plus d'œufs`],

    ['CE', 9, 17, `Emploi de « déjà – pas encore »`, 'Q',
`As-tu déjà mangé ? | Non, je n'ai pas encore mangé
As-tu déjà lu ? | Non, je n'ai pas encore lu
As-tu déjà dormi ? | Non, je n'ai pas encore dormi`,
`As-tu déjà écrit ? | Non, je n'ai pas encore écrit
As-tu déjà fini ? | Non, je n'ai pas encore fini
As-tu déjà chanté ? | Non, je n'ai pas encore chanté
As-tu déjà joué ? | Non, je n'ai pas encore joué`,
`laver | As-tu déjà lavé ? | Non, je n'ai pas encore lavé
balayer | As-tu déjà balayé ? | Non, je n'ai pas encore balayé
faire les devoirs | As-tu déjà fait tes devoirs ? | Non, je n'ai pas encore fait mes devoirs
ranger | As-tu déjà rangé ? | Non, je n'ai pas encore rangé
cuisiner | As-tu déjà cuisiné ? | Non, je n'ai pas encore cuisiné
nettoyer | As-tu déjà nettoyé ? | Non, je n'ai pas encore nettoyé`],

    ['CE', 10, 18, `Emploi de « encore – ne… plus »`, 'Q',
`Manges-tu encore ? | Je ne mange plus
Dors-tu encore ? | Je ne dors plus
Danses-tu encore ? | Je ne danse plus`,
`Pleures-tu encore ? | Je ne pleure plus
Joues-tu encore ? | Je ne joue plus
Parles-tu encore ? | Je ne parle plus
Lis-tu encore ? | Je ne lis plus`,
`chanter | Chantes-tu encore ? | Je ne chante plus
travailler | Travailles-tu encore ? | Je ne travaille plus
crier | Cries-tu encore ? | Je ne crie plus
courir | Cours-tu encore ? | Je ne cours plus
écrire | Écris-tu encore ? | Je n'écris plus
rire | Ris-tu encore ? | Je ne ris plus`],

    ['CE', 10, 19, `Emploi du pronom personnel « y »`, 'Q',
`Vas-tu à l'école ? | Oui, j'y vais
Vas-tu au marché ? | Non, je n'y vais pas
Vas-tu au centre de santé ? | Oui, j'y vais`,
`Vas-tu à l'église ? | Oui, j'y vais
Vas-tu au champ ? | Non, je n'y vais pas
Vas-tu à la cantine ? | Non, je n'y vais pas
Vas-tu à la bibliothèque ? | Oui, j'y vais`,
`au village (oui) | Vas-tu au village ? | Oui, j'y vais
à la maison (non) | Vas-tu à la maison ? | Non, je n'y vais pas
au jardin (oui) | Vas-tu au jardin ? | Oui, j'y vais
à l'hôpital (non) | Vas-tu à l'hôpital ? | Non, je n'y vais pas
au terrain (oui) | Vas-tu au terrain ? | Oui, j'y vais
à la cuisine (non) | Vas-tu à la cuisine ? | Non, je n'y vais pas`],

    ['CE', 11, 20, `Emploi des pronoms personnels « le, la »`, 'Q',
`Vois-tu le maître ? | Oui, je le vois
Connais-tu la maîtresse du CM1 ? | Oui, je la connais
Vois-tu la maîtresse ? | Oui, je la vois`,
`Prends-tu le ballon ? | Oui, je le prends
Lis-tu la leçon ? | Oui, je la lis
Cherches-tu le cahier ? | Oui, je le cherche
Salues-tu la directrice ? | Oui, je la salue`,
`tableau – nettoyer | Nettoies-tu le tableau ? | Oui, je le nettoie
porte – fermer | Fermes-tu la porte ? | Oui, je la ferme
cahier – prendre | Prends-tu le cahier ? | Oui, je le prends
craie – voir | Vois-tu la craie ? | Oui, je la vois
livre – lire | Lis-tu le livre ? | Oui, je le lis
table – laver | Laves-tu la table ? | Oui, je la lave`],

    ['CE', 11, 21, `Emploi du pronom personnel « les »`, 'Q',
`Ranges-tu tes affaires ? | Oui, je les range
Laves-tu tes vêtements ? | Oui, je les lave
Fermes-tu tes cahiers ? | Oui, je les ferme`,
`Lis-tu tes livres ? | Oui, je les lis
Écris-tu tes leçons ? | Oui, je les écris
Prends-tu tes crayons ? | Oui, je les prends
Cherches-tu tes sandales ? | Oui, je les cherche`,
`cahiers – ranger | Ranges-tu tes cahiers ? | Oui, je les range
sandales – nettoyer | Nettoies-tu tes sandales ? | Oui, je les nettoie
devoirs – faire | Fais-tu tes devoirs ? | Oui, je les fais
habits – plier | Plies-tu tes habits ? | Oui, je les plie
livres – lire | Lis-tu tes livres ? | Oui, je les lis
assiettes – laver | Laves-tu tes assiettes ? | Oui, je les lave`],

    ['CE', 12, 22, `Emploi du pronom personnel « l' »`, 'Q',
`Aimes-tu ta mère ? | Oui, je l'aime
Aimes-tu ton père ? | Oui, je l'aime
Aimes-tu ton frère ? | Oui, je l'aime`,
`Aides-tu ta sœur ? | Oui, je l'aide
Écoutes-tu le maître ? | Oui, je l'écoute
Aides-tu ton père ? | Oui, je l'aide
Écoutes-tu ta mère ? | Oui, je l'écoute`,
`ouvrir – porte | Ouvres-tu la porte ? | Oui, je l'ouvre
habiller – frère | Habilles-tu ton frère ? | Oui, je l'habille
écouter – maîtresse | Écoutes-tu la maîtresse ? | Oui, je l'écoute
aimer – grand-mère | Aimes-tu ta grand-mère ? | Oui, je l'aime
aider – maman | Aides-tu ta maman ? | Oui, je l'aide
ouvrir – fenêtre | Ouvres-tu la fenêtre ? | Oui, je l'ouvre`],

    ['CE', 12, 23, `Emploi du pronom personnel « en »`, 'Q',
`Veux-tu du riz ? | Oui, j'en veux
Veux-tu de l'eau ? | Non, je n'en veux pas
Veux-tu de l'huile ? | Oui, j'en veux`,
`Veux-tu du lait ? | Oui, j'en veux
Veux-tu des mangues ? | Non, je n'en veux pas
Veux-tu des bananes ? | Non, je n'en veux pas
Veux-tu du poisson ? | Oui, j'en veux`,
`du pain (oui) | Veux-tu du pain ? | Oui, j'en veux
de la viande (non) | Veux-tu de la viande ? | Non, je n'en veux pas
des oranges (oui) | Veux-tu des oranges ? | Oui, j'en veux
du sucre (non) | Veux-tu du sucre ? | Non, je n'en veux pas
du lait (non) | Veux-tu du lait ? | Non, je n'en veux pas
des arachides (oui) | Veux-tu des arachides ? | Oui, j'en veux`],

    ['CE', 12, 24, `Emploi de « c'est moi qui ai… »`, 'Q',
`Qui a pris le bic de Paul ? | C'est moi qui ai pris le bic de Paul
Qui a nettoyé le tableau ? | C'est moi qui ai nettoyé le tableau
Qui a ouvert la fenêtre ? | C'est moi qui ai ouvert la fenêtre`,
`Qui a balayé la classe ? | C'est moi qui ai balayé la classe
Qui a lavé la craie ? | C'est moi qui ai lavé la craie
Qui a fermé la porte ? | C'est moi qui ai fermé la porte
Qui a rangé les cahiers ? | C'est moi qui ai rangé les cahiers`,
`cahier – prendre | Qui a pris le cahier ? | C'est moi qui ai pris le cahier
porte – ouvrir | Qui a ouvert la porte ? | C'est moi qui ai ouvert la porte
gomme – donner | Qui a donné la gomme ? | C'est moi qui ai donné la gomme
table – nettoyer | Qui a nettoyé la table ? | C'est moi qui ai nettoyé la table
craie – prendre | Qui a pris la craie ? | C'est moi qui ai pris la craie
livre – lire | Qui a lu le livre ? | C'est moi qui ai lu le livre`],

    ['CE', 12, 25, `Emploi de « c'est moi qui suis… »`, 'Q',
`Qui est allé chez le maître ? | C'est moi qui suis allé chez le maître
Qui est dans la classe ? | C'est moi qui suis dans la classe
Qui est à la maison ? | C'est moi qui suis à la maison`,
`Qui est au tableau ? | C'est moi qui suis au tableau
Qui est arrivé le premier ? | C'est moi qui suis arrivé le premier
Qui est devant la classe ? | C'est moi qui suis devant la classe
Qui est parti le premier ? | C'est moi qui suis parti le premier`,
`bibliothèque | Qui est à la bibliothèque ? | C'est moi qui suis à la bibliothèque
sortir | Qui est sorti ? | C'est moi qui suis sorti
devant la porte | Qui est devant la porte ? | C'est moi qui suis devant la porte
assis | Qui est assis ? | C'est moi qui suis assis
à l'école | Qui est à l'école ? | C'est moi qui suis à l'école
arrivé | Qui est arrivé ? | C'est moi qui suis arrivé`],

    /* ===================== CM1 ===================== */
    ['CM1', null, 1, `Emploi de « oui » et « non »`, 'Q',
`Iras-tu à l'école cet après-midi ? | Oui, j'irai à l'école
As-tu un sac ? | Oui, j'ai un sac
Iras-tu au terrain cet après-midi ? | Non, je n'irai pas au terrain
Ira-t-elle à la fête ? | Non, elle n'ira pas à la fête`,
`Iras-tu au marché demain ? | Oui, j'irai au marché
As-tu une chemise neuve ? | Oui, j'ai une chemise neuve
As-tu un vélo ? | Non, je n'ai pas de vélo
Iras-tu à la fête ? | Non, je n'irai pas à la fête`,
`être au marché (oui) | Es-tu au marché ? | Oui, je suis au marché
avoir une chemise neuve (oui) | As-tu une chemise neuve ? | Oui, j'ai une chemise neuve
avoir un vélo (non) | As-tu un vélo ? | Non, je n'ai pas de vélo
aller à l'école (oui) | Iras-tu à l'école demain ? | Oui, j'irai à l'école
avoir un cahier (oui) | As-tu un cahier ? | Oui, j'ai un cahier
aller au champ (non) | Iras-tu au champ ? | Non, je n'irai pas au champ`],

    ['CM1', null, 2, `Emploi de « si » et « pas de… »`, 'Q',
`N'apprends-tu pas tes leçons les samedis ? | Si
N'as-tu pas soif ? | Si
Achètes-tu des mangues ? | Non, je n'achète pas de mangue
Prends-tu de la moutarde ? | Non, je ne prends pas de moutarde`,
`N'as-tu pas faim ? | Si
Ne lis-tu pas ton livre ? | Si
Prends-tu du sucre ? | Non, je ne prends pas de sucre
Manges-tu des oranges ? | Non, je ne mange pas d'oranges`,
`dire la vérité | Ne dis-tu pas la vérité ? | Si, je dis la vérité
être fatigué | N'es-tu pas fatigué ? | Si, je suis fatigué
avoir un dictionnaire | As-tu un dictionnaire ? | Non, je n'ai pas de dictionnaire
cueillir des oranges | Cueilles-tu des oranges ? | Non, je ne cueille pas d'oranges
avoir un cahier | N'as-tu pas de cahier ? | Si, j'ai un cahier
boire du lait | Bois-tu du lait ? | Non, je ne bois pas de lait`],

    ['CM1', null, 3, `Emploi de « plus de » et « moi aussi »`, 'Q',
`Veux-tu encore du pain ? | Non, je ne veux plus de pain
As-tu encore de l'argent ? | Non, je n'ai plus d'argent
Je serai au CM2 l'an prochain ! Et toi ? | Moi aussi
J'aime lire ! Et toi ? | Moi aussi`,
`Veux-tu encore du lait ? | Non, je ne veux plus de lait
As-tu encore des exercices à faire ? | Non, je n'ai plus d'exercices à faire
J'aime le sport ! Et toi ? | Moi aussi
Je sais courir vite ! Et toi ? | Moi aussi`,
`avoir encore des exercices à faire | As-tu encore des exercices à faire ? | Non, je n'ai plus d'exercices à faire
avoir encore de la tomate à moudre | As-tu encore de la tomate à moudre ? | Non, je n'ai plus de tomate à moudre
savoir lancer une balle | Je sais lancer une balle ! Et toi ? | Moi aussi
courir vite | Je cours vite ! Et toi ? | Moi aussi
aimer le sport | J'aime le sport ! Et toi ? | Moi aussi
avoir encore du riz | As-tu encore du riz ? | Non, je n'ai plus de riz`],

    ['CM1', null, 4, `Emploi de « autant de… que de… », « moins de… que de… », « plus de… que de… »`, 'E',
`J'ai deux stylos et deux crayons | J'ai autant de stylos que de crayons
Abou a 3 frères et 3 sœurs | Abou a autant de frères que de sœurs
J'achète 10 mangues et 5 bananes | J'achète plus de mangues que de bananes
Dans la classe, il y a 25 filles et 32 garçons | Dans la classe, il y a moins de filles que de garçons`,
`J'ai 4 livres et 4 cahiers | J'ai autant de livres que de cahiers
Paul a 2 sœurs et 5 frères | Paul a moins de sœurs que de frères
Il y a 12 chèvres et 8 moutons | Il y a plus de chèvres que de moutons
Awa a 3 jupes et 3 robes | Awa a autant de jupes que de robes`,
`15 cahiers et 15 livres | Qu'as-tu ? | J'ai autant de cahiers que de livres
10 ballons et 10 joueurs | Que remarques-tu ? | Il y a autant de ballons que de joueurs
18 maillots et 18 joueurs | Que remarques-tu ? | Il y a autant de maillots que de joueurs
5 ananas et 9 papayes | Qu'achètes-tu ? | J'achète moins d'ananas que de papayes
20 hommes et 12 femmes | Qui est là ? | Il y a plus d'hommes que de femmes
3 vélos et 7 motos | Que vois-tu ? | Je vois moins de vélos que de motos`],

    ['CM1', null, 5, `Emploi de « en » et « y »`, 'Q',
`As-tu un cahier neuf dans ton sac ? | Oui, j'en ai
Veux-tu de la bouillie ? | Oui, j'en veux
Vas-tu en ville cet après-midi ? | Oui, j'y vais
Répondras-tu à cette invitation ? | Non, je n'y répondrai pas`,
`As-tu un livre de math ? | Oui, j'en ai un
Veux-tu du lait ? | Non, je n'en veux pas
Vas-tu au marché ? | Oui, j'y vais
Iras-tu à la fête ? | Non, je n'y irai pas`,
`vouloir prendre du lait | Veux-tu prendre du lait ? | Oui, j'en veux
posséder un livre de math | Possèdes-tu un livre de math ? | Oui, j'en possède un
se rendre au marché | Te rends-tu au marché ? | Oui, je m'y rends
aller au terrain | Vas-tu au terrain ? | Non, je n'y vais pas
aller à la fête | Vas-tu à la fête ? | Oui, j'y vais
avoir du pain | As-tu du pain ? | Non, je n'en ai pas`],

    ['CM1', null, 6, `Emploi de « le, la, les, l' » (pronoms) et « lui, leur »`, 'Q',
`Reconnais-tu ce garçon ? | Oui, je le reconnais
Reconnais-tu cette fille ? | Oui, je la reconnais
Reconnais-tu ces enfants ? | Oui, je les reconnais
As-tu vu Joséphine hier ? | Oui, je l'ai vue
Donnes-tu des conseils à ton voisin ? | Oui, je lui en donne
Écris-tu souvent à tes parents ? | Oui, je leur écris souvent`,
`Vois-tu ce jeune homme ? | Oui, je le vois
Recherches-tu sa sœur ? | Oui, je la recherche
Laves-tu tes cheveux ? | Oui, je les lave
Téléphones-tu à tes frères ? | Oui, je leur téléphone`,
`voir ce jeune homme | Vois-tu ce jeune homme ? | Oui, je le vois
rechercher sa sœur | Recherches-tu ta sœur ? | Oui, je la recherche
laver ses cheveux | Laves-tu tes cheveux ? | Oui, je les lave
tailler son crayon | Tailles-tu ton crayon ? | Oui, je le taille
obéir à ses parents | Obéis-tu à tes parents ? | Oui, je leur obéis
donner de la banane à son frère | Donnes-tu de la banane à ton frère ? | Oui, je lui en donne`],

    ['CM1', null, 7, `Emploi de « le lui », « le leur », « la lui », « la leur »`, 'Q',
`Je prête mon livre à Dossou | Je le lui prête
Je partage mon beignet à mes amis | Je le leur partage
Montres-tu ta photo à ton ami ? | Oui, je la lui montre
Expliques-tu la mathématique à tes petits frères ? | Oui, je la leur explique`,
`Je prête mon stylo à Awa | Je le lui prête
Je donne mon cahier à mes camarades | Je le leur donne
Montres-tu ta robe à ta sœur ? | Oui, je la lui montre
Expliques-tu la leçon à tes amis ? | Oui, je la leur explique`,
`apprendre un chant à un camarade | Apprends-tu ce chant à un camarade ? | Oui, je le lui apprends
réciter une leçon à son père | Récites-tu ta leçon à ton père ? | Oui, je la lui récite
confier une tâche à ses frères | Confies-tu cette tâche à tes frères ? | Oui, je la leur confie
prêter un livre à Dossou | Prêtes-tu ton livre à Dossou ? | Oui, je le lui prête
montrer sa photo à ses amis | Montres-tu ta photo à tes amis ? | Oui, je la leur montre
expliquer l'exercice à son voisin | Expliques-tu l'exercice à ton voisin ? | Oui, je le lui explique`],

    ['CM1', null, 8, `Emploi de « personne » et « rien »`, 'Q',
`Qui attends-tu ici ? | Personne
Qui connais-tu à Parakou ? | Personne
Qu'as-tu mangé ce matin ? | Rien
Que cherches-tu là ? | Rien`,
`Qui vois-tu dans la classe ? | Personne
Qui appelles-tu ? | Personne
Que prends-tu ? | Rien
Qu'entends-tu ? | Rien`,
`regarder dans la cour | Qui regardes-tu dans la cour ? | Personne
prendre quelque chose au salon | Que prends-tu au salon ? | Rien
chercher dans le sac | Que cherches-tu dans le sac ? | Rien
attendre à la porte | Qui attends-tu à la porte ? | Personne
voir au marché | Qui vois-tu au marché ? | Personne
manger à la récréation | Qu'as-tu mangé à la récréation ? | Rien`],

    ['CM1', null, 9, `Emploi de « cependant » et « néanmoins »`, 'Q',
`Les ouvriers sont-ils présents à leur poste ? | Oui, cependant ils ne travaillent pas
Cet élève travaille-t-il bien en classe ? | Oui, cependant il a échoué à son examen
Tes parents te grondent-ils ? | Oui, néanmoins, ils m'aiment beaucoup
As-tu un ami ? | Non, néanmoins, j'ai de gentils camarades`,
`Es-tu malade ? | Oui, cependant je vais à l'école
Le maître est-il sévère ? | Oui, néanmoins il est juste
Cet enfant est-il petit ? | Oui, cependant il court vite
As-tu peur du chien ? | Oui, néanmoins je le caresse`,
`prendre des médicaments / guérir | Prends-tu des médicaments ? | Oui, cependant je ne guéris pas
lire la notice / comprendre | Lis-tu la notice ? | Oui, cependant je ne la comprends pas
boire de l'eau glacée / fraîche | Bois-tu de l'eau glacée ? | Non, néanmoins j'aime l'eau fraîche
être vedette / chanter bien | Es-tu une vedette ? | Non, néanmoins je chante bien
avoir un vélo / aller à pied | As-tu un vélo ? | Oui, cependant je vais à pied
être fatigué / travailler | Es-tu fatigué ? | Oui, néanmoins je travaille`],

    ['CM1', null, 10, `Emploi de « suffisamment » et « pas assez »`, 'Q',
`Voudrais-tu encore du biscuit ? | Non, merci, j'en ai suffisamment mangé
Voici encore un peu d'eau | Non, merci, j'en ai suffisamment bu
As-tu bien travaillé en évaluation ? | Non, pas assez
As-tu suffisamment de vivres pour le reste du mois ? | Non, pas assez`,
`Voudrais-tu encore du riz ? | Non, merci, j'en ai suffisamment mangé
Voici encore un peu de lait | Non, merci, j'en ai suffisamment bu
As-tu assez étudié ? | Non, pas assez
As-tu assez dormi ? | Non, pas assez`,
`manger de la pâte | Voudrais-tu encore de la pâte ? | Non, merci, j'en ai suffisamment mangé
lire des contes | As-tu assez lu de contes ? | Non, pas assez
faire réserve d'eau | As-tu suffisamment d'eau en réserve ? | Non, pas assez
boire du jus | Voici encore du jus | Non, merci, j'en ai suffisamment bu
travailler à la maison | As-tu assez travaillé à la maison ? | Non, pas assez
manger du pain | Voudrais-tu encore du pain ? | Non, merci, j'en ai suffisamment mangé`],

    ['CM1', null, 11, `Emploi de « ni l'un, ni l'autre » et « aucun, aucune »`, 'Q',
`Aimes-tu du gari ou du pain ? | Je n'aime ni l'un, ni l'autre
Vois-tu encore Jean et Comlan ? | Je ne vois plus ni l'un, ni l'autre
Cet homme que tu as vu a-t-il des cheveux blancs ? | Il n'en a aucun
Éprouvez-vous des difficultés à résoudre cet exercice ? | Je n'en éprouve aucune`,
`Aimes-tu le riz ou le maïs ? | Je n'aime ni l'un, ni l'autre
Connais-tu Paul et Sara ? | Je ne connais ni l'un, ni l'autre
As-tu des cahiers neufs ? | Je n'en ai aucun
As-tu des difficultés en lecture ? | Je n'en ai aucune`,
`préférer l'igname ou le manioc | Préfères-tu l'igname ou le manioc ? | Je ne préfère ni l'un, ni l'autre
recevoir de mauvaises notes | As-tu de mauvaises notes ? | Je n'en ai aucune
élèves dans la cour | Y a-t-il des élèves dans la cour ? | Il n'y en a aucun
aimer le thé ou le café | Aimes-tu le thé ou le café ? | Je n'aime ni l'un, ni l'autre
avoir des billes | As-tu des billes ? | Je n'en ai aucune
voir Awa et Sara | Vois-tu Awa et Sara ? | Je ne vois ni l'une, ni l'autre`],

    ['CM1', null, 12, `Emploi de « bientôt » et « beaucoup »`, 'Q',
`La saison des pluies est là. Dans peu de temps, les cultivateurs sèmeront | Bientôt les cultivateurs sèmeront
Le repas est presque prêt, nous mangerons tout à l'heure | Le repas est presque prêt, bientôt nous mangerons
N'y a-t-il qu'un seul balai dans la classe ? | Non, il y en a beaucoup
Maman n'a-t-elle qu'une seule tenue super wax ? | Non, elle en a beaucoup`,
`Les vacances finissent dans peu de temps | Bientôt la rentrée
Le soleil va disparaître | Bientôt il fera nuit
N'as-tu qu'un seul cahier ? | Non, j'en ai beaucoup
N'y a-t-il qu'une seule chaise ? | Non, il y en a beaucoup`,
`vacances finies : rentrée scolaire | Les vacances finissent dans peu de temps | Bientôt la rentrée scolaire
soleil disparu à l'horizon : la nuit | Le soleil va disparaître | Bientôt il fera nuit
une seule fille dans sa classe | N'y a-t-il qu'une seule fille dans ta classe ? | Non, il y en a beaucoup
une seule orange mûre | N'y a-t-il qu'une seule orange mûre ? | Non, il y en a beaucoup
la saison sèche qui finit | La saison sèche finit dans peu de temps | Bientôt la saison des pluies
un seul livre sur la table | N'y a-t-il qu'un seul livre sur la table ? | Non, il y en a beaucoup`],

    /* ===================== CM2 ===================== */
    ['CM2', null, 1, `Emploi de « aucun » et « aucune »`, 'Q',
`J'ai un frère dans la classe. Et toi ? | Aucun
Vois-tu des garçons dans la cour ? | Aucun
Y a-t-il des filles dans la cour ? | Aucune
Vois-tu des mangues sur le manguier ? | Aucune`,
`Vois-tu des chapeaux ici ? | Aucun
Y a-t-il des élèves absents ? | Aucun
As-tu des sœurs dans la classe ? | Aucune
Vois-tu des oranges sur l'arbre ? | Aucune`,
`avoir plusieurs chapeaux | As-tu plusieurs chapeaux ? | Aucun
avoir des moyens pour s'acheter ce livre | As-tu des moyens pour t'acheter ce livre ? | Aucun
avoir des pièces de monnaie | As-tu des pièces de monnaie ? | Aucune
avoir des aiguilles dans la boîte à couture | Y a-t-il des aiguilles dans la boîte à couture ? | Aucune
avoir des crayons | As-tu des crayons dans ton sac ? | Aucun
avoir des chaises dans la cour | Y a-t-il des chaises dans la cour ? | Aucune`],

    ['CM2', null, 2, `Emploi de « le seul » et « la seule »`, 'Q',
`As-tu un crayon à me prêter ? | Non, j'utilise le seul que j'ai
As-tu des protège-cahiers ? | Le seul que je possède est usagé
Les boutiques sont-elles ouvertes ce matin ? | La seule ouverte n'est pas achalandée
Y a-t-il des stations de SONACOP dans ton quartier / village ? | La seule qui existe est en panne`,
`As-tu un stylo à me prêter ? | Non, j'utilise le seul que j'ai
As-tu une règle ? | La seule que j'ai est cassée
Y a-t-il des puits dans ton village ? | Le seul qui existe est à sec
Y a-t-il des écoles dans ton village ? | La seule qui existe est petite`,
`croiser des vendeuses de poissons | As-tu croisé des vendeuses de poissons ? | La seule que j'ai croisée vend du poisson
voir des fruits sur l'arbre | Vois-tu des fruits sur l'arbre ? | Le seul que je vois est vert
avoir des tenues de sport | As-tu des tenues de sport ? | La seule que j'ai est usée
avoir beaucoup d'amis | As-tu beaucoup d'amis ? | Le seul que j'ai est Paul
avoir des bicyclettes | As-tu des bicyclettes ? | La seule que j'ai est vieille
avoir des stylos | As-tu des stylos ? | Le seul que j'ai est bleu`],

    ['CM2', null, 3, `Emploi de « rien » et « personne »`, 'Q',
`Y a-t-il quelque chose à manger ? | Il n'y a rien à manger
Vois-tu quelque chose sur l'arbre ? | Je ne vois rien sur l'arbre
Y a-t-il quelqu'un à la direction ? | Il n'y a personne
Quelqu'un serait-il venu pendant mon absence ? | Personne`,
`Y a-t-il quelque chose dans la boîte ? | Il n'y a rien dans la boîte
Entends-tu quelque chose ? | Je n'entends rien
Y a-t-il quelqu'un dans la classe ? | Il n'y a personne
Quelqu'un t'a-t-il appelé ? | Personne`,
`avoir besoin de quelque chose | As-tu besoin de quelque chose ? | Je n'ai besoin de rien
penser à quelque chose | Penses-tu à quelque chose ? | Je ne pense à rien
attendre quelqu'un | Attends-tu quelqu'un ? | Je n'attends personne
provoquer quelqu'un | Provoques-tu quelqu'un ? | Je ne provoque personne
voir quelqu'un dans la cour | Vois-tu quelqu'un dans la cour ? | Je ne vois personne
trouver quelque chose | As-tu trouvé quelque chose ? | Je n'ai rien trouvé`],

    ['CM2', null, 4, `Emploi de « nulle part » et « souvent »`, 'Q',
`As-tu rencontré mon frère quelque part ? | Non, je ne l'ai rencontré nulle part
La récolte a-t-elle été bonne dans certains villages ? | Non, elle n'a été bonne nulle part
Aides-tu ta maman à la cuisine ? | Oui, je l'aide souvent
Manges-tu quelquefois du pain ? | Oui, j'en mange souvent
Vas-tu quelquefois à la fête ? | Oui, j'y vais souvent`,
`As-tu vu mon livre quelque part ? | Non, je ne l'ai vu nulle part
As-tu trouvé de l'eau quelque part ? | Non, je n'en ai trouvé nulle part
Joues-tu quelquefois au ballon ? | Oui, j'y joue souvent
Laves-tu tes habits ? | Oui, je les lave souvent`,
`aller quelque part | Vas-tu quelque part ? | Non, je ne vais nulle part
construire une maison quelque part | Construis-tu une maison quelque part ? | Non, je n'en construis nulle part
jouer au ballon | Joues-tu au ballon ? | Oui, j'y joue souvent
laver ses habits soi-même | Laves-tu tes habits toi-même ? | Oui, je les lave souvent
aller au champ | Vas-tu quelquefois au champ ? | Oui, j'y vais souvent
chercher son stylo | As-tu cherché ton stylo quelque part ? | Oui, mais je ne l'ai trouvé nulle part`],

    ['CM2', null, 5, `Emploi de « dès que » et « parce que »`, 'Q',
`À quel moment te réveilles-tu les matins ? | Je me réveille dès que le coq chante
Quand manges-tu dans la journée ? | Je mange dès que le repas est prêt
Pourquoi te tais-tu ? | Je me tais parce que je n'ai rien à dire
Pourquoi y a-t-il beaucoup de gens à la place publique ? | Il y a beaucoup de gens à la place publique parce que c'est la fête de l'indépendance`,
`À quel moment pars-tu à l'école ? | Je pars dès que j'ai fini de manger
Quand lis-tu ? | Je lis dès que je suis libre
Pourquoi pleures-tu ? | Je pleure parce que j'ai mal
Pourquoi ris-tu ? | Je ris parce que c'est drôle`,
`faire des travaux domestiques | Quand fais-tu les travaux domestiques ? | Je les fais dès que je rentre
prendre le petit déjeuner | Quand prends-tu le petit déjeuner ? | Je le prends dès que je me lève
murmurer | Pourquoi murmures-tu ? | Je murmure parce que je ne veux pas déranger
dormir | Pourquoi dors-tu ? | Je dors parce que je suis fatigué
être absent | Pourquoi es-tu absent ? | Je suis absent parce que je suis malade
manger | Quand manges-tu ? | Je mange dès que j'ai faim`],

    ['CM2', null, 6, `Emploi de « le mien », « le tien », « le sien » et « le nôtre », « le vôtre », « le leur »`, 'E',
`Ce livre est à moi | C'est le mien
Cette chaise est à moi | C'est la mienne
Ce crayon est à toi | C'est le tien
Cette robe est à Aline | C'est la sienne
Ce tableau est à nous | C'est le nôtre
Cette maison est à nous | C'est la nôtre
Ce banc est à vous | C'est le vôtre
Cette règle est à vous | C'est la vôtre
Cette maison est aux enfants Zinsou | C'est la leur
Ces enfants sont à eux | Ce sont les leurs`,
`Ce cahier est à moi | C'est le mien
Cette gomme est à toi | C'est la tienne
Ce ballon est à Paul | C'est le sien
Cette table est à nous | C'est la nôtre`,
`ce crayon – moi | Ce crayon est à moi | C'est le mien
ce sac – toi | Ce sac est à toi | C'est le tien
cette armoire – elle | Cette armoire est à elle | C'est la sienne
ce vélo – nous | Ce vélo est à nous | C'est le nôtre
cette clé – vous | Cette clé est à vous | C'est la vôtre
ces cahiers – eux | Ces cahiers sont à eux | Ce sont les leurs`],

    ['CM2', null, 7, `Emploi de « c'est moi » et « pour que »`, 'E',
`Qui a balayé la classe ce matin ? | C'est moi qui l'ai balayée
Qui a essuyé le tableau ? | C'est moi qui l'ai essuyé
Donne-moi ton adresse. Je vais t'écrire | Donne-moi ton adresse pour que je t'écrive
Ne soyons pas en retard. Mangeons vite | Pour qu'on ne soit pas en retard, mangeons vite`,
`Qui a lavé les assiettes ? | C'est moi qui les ai lavées
Qui a fermé la porte ? | C'est moi qui l'ai fermée
Prête-moi ton livre. Je vais lire | Prête-moi ton livre pour que je lise
Parle fort. Nous voulons t'entendre | Parle fort pour que nous t'entendions`,
`préparer le repas | Qui a préparé le repas ? | C'est moi qui l'ai préparé
laver les habits | Qui a lavé les habits ? | C'est moi qui les ai lavés
dire la vérité | Dis la vérité. Je vais te croire | Dis la vérité pour que je te croie
se dépêcher | Dépêche-toi. Nous ne voulons pas arriver tard | Dépêche-toi pour que nous n'arrivions pas tard
être à l'heure | Sois à l'heure. Le maître sera content | Sois à l'heure pour que le maître soit content
ranger la classe | Qui a rangé la classe ? | C'est moi qui l'ai rangée`],

    ['CM2', null, 8, `Emploi de « toi et moi » et « lui et moi »`, 'E',
`travailler bien en classe (toi et moi) | Toi et moi travaillons bien en classe
balayer la cour de l'école (toi et moi) | Toi et moi balayons la cour de l'école
voyager pendant le congé (lui et moi) | Lui et moi voyagerons pendant le congé
aimer le football (lui et moi) | Lui et moi aimons le football`,
`chanter (toi et moi) | Toi et moi chantons
lire un conte (toi et moi) | Toi et moi lisons un conte
aller au marché (lui et moi) | Lui et moi allons au marché
jouer au ballon (lui et moi) | Lui et moi jouons au ballon`,
`jouer au ballon (toi et moi) | Que faisons-nous ? | Toi et moi jouons au ballon
manger du riz (toi et moi) | Que faisons-nous ? | Toi et moi mangeons du riz
aligner les tables (lui et moi) | Que faisons-nous ? | Lui et moi alignons les tables
ranger les affaires du maître (lui et moi) | Que faisons-nous ? | Lui et moi rangeons les affaires du maître
écrire une lettre (toi et moi) | Que faisons-nous ? | Toi et moi écrivons une lettre
laver les habits (lui et moi) | Que faisons-nous ? | Lui et moi lavons les habits`],

    ['CM2', null, 9, `Emploi de « malgré » et « lorsque »`, 'E',
`Le temps est mauvais ; je suis allé en promenade | Malgré le mauvais temps, je suis allé en promenade
Les pluies ont été régulières, mais les récoltes sont mauvaises | Malgré la régularité des pluies, les récoltes ont été mauvaises
Je suis fatigué, je me repose | Je me repose lorsque je suis fatigué
Il fait jour, je me lève | Je me lève lorsqu'il fait jour`,
`Il pleut ; je vais à l'école | Malgré la pluie, je vais à l'école
Il est malade ; il travaille | Malgré sa maladie, il travaille
J'ai faim, je mange | Je mange lorsque j'ai faim
J'ai soif, je bois | Je bois lorsque j'ai soif`,
`être encore fort | Il est fatigué, mais il est encore fort | Malgré sa fatigue, il est encore fort
n'être pas guéri | Il n'est pas guéri, mais il va à l'école | Malgré sa maladie, il va à l'école
ne pas avoir raison | Tu n'as pas raison, tu dois te taire | Tu dois te taire lorsque tu n'as pas raison
avoir soif | J'ai soif, je bois de l'eau | Je bois de l'eau lorsque j'ai soif
avoir sommeil | J'ai sommeil, je dors | Je dors lorsque j'ai sommeil
être en colère | Il est en colère, mais il se tait | Malgré sa colère, il se tait`],

    ['CM2', null, 10, `Emploi de « grâce à »`, 'E',
`Tu as fait un témoignage et mes parents m'ont cru | Mes parents m'ont cru grâce à ton témoignage
J'ai fait des efforts et j'ai réussi à mon examen | J'ai réussi à mon examen grâce à mes efforts quotidiens
Tu m'as aidé et j'ai fini mon travail | J'ai fini mon travail grâce à ton aide`,
`Le maître a expliqué et j'ai compris | J'ai compris grâce au maître
Les pluies sont venues et les récoltes sont bonnes | Les récoltes sont bonnes grâce aux pluies
Tu m'as prêté un livre et j'ai étudié | J'ai étudié grâce à ton livre
Mon ami m'a conseillé et j'ai réussi | J'ai réussi grâce aux conseils de mon ami`,
`les récoltes ont été abondantes | Pourquoi les récoltes ont-elles été abondantes ? | Elles ont été abondantes grâce aux bonnes pluies
moins d'accidents de la circulation cette année | Pourquoi y a-t-il moins d'accidents cette année ? | Il y en a moins grâce au respect du code de la route
réussir à l'examen | Pourquoi as-tu réussi à l'examen ? | J'ai réussi grâce à mon travail
guérir | Pourquoi es-tu guéri ? | Je suis guéri grâce aux médicaments
avoir de l'eau | Pourquoi as-tu de l'eau ? | J'ai de l'eau grâce au puits
finir tôt | Pourquoi as-tu fini tôt ? | J'ai fini tôt grâce à mes amis`],

    ['CM2', null, 11, `Emploi de « à cause de »`, 'E',
`La grande sécheresse a tari tous les puits | À cause de la grande sécheresse, tous les puits ont tari
Mon ami est paresseux ; il a redoublé sa classe | Mon ami a redoublé sa classe à cause de sa paresse
Il pleut ; le match est annulé | Le match est annulé à cause de la pluie`,
`Il y a du bruit ; je dors mal | Je dors mal à cause du bruit
Il est malade ; il est absent | Il est absent à cause de sa maladie
Il y a du vent ; la porte s'est fermée | La porte s'est fermée à cause du vent
La route est mauvaise ; nous sommes en retard | Nous sommes en retard à cause de la mauvaise route`,
`mal dormir la nuit | Pourquoi dors-tu mal la nuit ? | Je dors mal à cause du bruit
faire de mauvais rêves | Pourquoi fais-tu de mauvais rêves ? | J'en fais à cause de la peur
être en retard | Pourquoi es-tu en retard ? | Je suis en retard à cause de la pluie
pleurer | Pourquoi pleures-tu ? | Je pleure à cause de la douleur
rester à la maison | Pourquoi restes-tu à la maison ? | Je reste à cause de la fatigue
perdre la récolte | Pourquoi as-tu perdu la récolte ? | Je l'ai perdue à cause de la sécheresse`],

    ['CM2', null, 12, `Emploi de « plus tôt » et « plutôt »`, 'Q',
`Iras-tu au marché à 10 h comme prévu ? | J'irai plus tôt
Viendras-tu demain à l'école à 7 h 30 ? | Je viendrai plus tôt
Iras-tu à l'école à vélo ? | J'irai plutôt à pied
Mangeras-tu du haricot pendant la récréation ? | Je mangerai plutôt du riz`,
`Te lèveras-tu à 6 h demain ? | Je me lèverai plus tôt
Partiras-tu à 8 h ? | Je partirai plus tôt
Boiras-tu du lait ? | Je boirai plutôt de l'eau
Liras-tu ce conte ? | Je lirai plutôt ce livre`,
`arriver à l'école | Arriveras-tu à l'heure demain ? | J'arriverai plus tôt
manger de l'igname / du riz | Mangeras-tu de l'igname ? | Je mangerai plutôt du riz
sortir à 17 h | Sortiras-tu à 17 h ? | Je sortirai plus tôt
voyager en car / à moto | Voyageras-tu en car ? | Je voyagerai plutôt à moto
se coucher à 22 h | Te coucheras-tu à 22 h ? | Je me coucherai plus tôt
acheter un cahier / un livre | Achèteras-tu un cahier ? | J'achèterai plutôt un livre`],

    ['CM2', null, 13, `Emploi de « rarement »`, 'Q',
`Manges-tu des galettes d'arachide ? | J'en mange rarement
Rencontrez-vous beaucoup de camarades au marché ? | Nous en rencontrons rarement
Manges-tu de la viande ? | J'en mange rarement
Vas-tu à la plage ? | J'y vais rarement`,
`Vas-tu au cinéma ? | J'y vais rarement
Bois-tu du lait ? | J'en bois rarement
Voyages-tu en avion ? | Je voyage rarement en avion
Vois-tu tes cousins ? | Je les vois rarement`,
`manger des beignets | Manges-tu des beignets ? | J'en mange rarement
aller au village | Vas-tu au village ? | J'y vais rarement
regarder la télévision | Regardes-tu la télévision ? | Je la regarde rarement
jouer au football | Joues-tu au football ? | J'y joue rarement
rencontrer des amis | Rencontres-tu des amis ? | Je les rencontre rarement
boire du jus | Bois-tu du jus ? | J'en bois rarement`]
  ];

  const GROUPES = {
    CE:  { label: 'CE1 / CE2', classes: ['CE1', 'CE2'] },
    CM1: { label: 'CM1',       classes: ['CM1'] },
    CM2: { label: 'CM2',       classes: ['CM2'] }
  };

  function lignes(txt){
    return String(txt).trim().split('\n').map(l => l.split('|').map(c => c.trim()).join(' | '));
  }
  function tableau(entetes, txt){
    return [entetes.join(' | ')].concat(lignes(txt)).join('\n');
  }

  const liste = RAW.map(r => {
    const [groupe, unite, numero, titre, col, intro, syst, appli] = r;
    const premiere = col === 'Q' ? 'Questions (Enseignants)' : 'Entrées (Enseignants)';
    return {
      id: groupe.toLowerCase() + '-' + numero,
      groupe, unite, numero, titre,
      intro: tableau([premiere, 'Réponses (Enseignants)'], intro),
      syst:  tableau([premiere, 'Réponses (Élève)'], syst),
      appli: tableau(['Entrées (Enseignant)', 'Questions (Élève 1)', 'Réponses (Élève 2)'], appli)
    };
  });

  const parId = {};
  liste.forEach(e => { parId[e.id] = e; });

  /* 'CE1' ou 'CE2' -> 'CE' ; 'CM1' -> 'CM1' ; 'CM2' -> 'CM2' ; sinon null. */
  function groupeDeClasse(classe){
    const c = String(classe || '').toUpperCase();
    if(c === 'CE1' || c === 'CE2') return 'CE';
    if(c === 'CM1') return 'CM1';
    if(c === 'CM2') return 'CM2';
    return null;
  }

  /* Détecte la classe (CE1, CE2, CM1, CM2) dans un texte libre, p. ex. le
     champ « Cours (classe) » de l'en-tête : « CE1 », « Ce 2 », « CM2 A »… */
  function detecterClasse(texte){
    const m = String(texte || '').toUpperCase().match(/(CE|CM)\s*([12])(?!\d)/);
    return m ? m[1] + m[2] : null;
  }

  window.EXERCICES_STRUCTURAUX = {
    liste, parId, groupes: GROUPES, groupeDeClasse, detecterClasse,
    pourGroupe: g => liste.filter(e => e.groupe === g)
  };
})();
