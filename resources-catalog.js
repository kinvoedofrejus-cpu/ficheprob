/* Catalogue des ressources didactiques (onglet "Ressources").
   L'onglet affiche une carte par type de ressource (GROUPES ci-dessous) ; chaque
   carte ouvre la liste de ses niveaux (CI, CP, CE1-CM2, CE1, CE2, CM1, CM2 selon le type).
   Chaque entrée correspond à un PDF + meta.json déposés dans R2 sous
   resource-pdfs/{id}.pdf et resource-pdfs/{id}.meta.json (voir
   admin-upload-resources.html / admin-upload-resource-pdf.js).
   L'identifiant est « {prefix}-{suffix} », ex. exercices-structuraux-ce1-cm2,
   calcul-mental-ce2, concretisation-cm1, projet-planification-ce1-cm2,
   schema-support-cm2, schema-support-ci, emploi-du-temps-cp, fournitures-scolaires-ce1.
   - classes : sert uniquement à l'affichage sous le titre.
   1er téléchargement offert, paiement à partir du 2e (voir downloadResource). */
(function(){
  const NIVEAUX = {
    ci:       { suffix: 'ci',      label: 'CI',      classes: ['CI'] },
    cp:       { suffix: 'cp',      label: 'CP',      classes: ['CP'] },
    'ce1-cm2':{ suffix: 'ce1-cm2', label: 'CE1-CM2', classes: ['CE1','CE2','CM1','CM2'] },
    ce1:      { suffix: 'ce1',     label: 'CE1',     classes: ['CE1'] },
    ce2:      { suffix: 'ce2',     label: 'CE2',     classes: ['CE2'] },
    cm1:      { suffix: 'cm1',     label: 'CM1',     classes: ['CM1'] },
    cm2:      { suffix: 'cm2',     label: 'CM2',     classes: ['CM2'] }
  };
  const N_CE_CM = ['ce1-cm2','ce1','ce2','cm1','cm2'];
  const N_CI_CM = ['ci','cp'].concat(N_CE_CM);          // + CI et CP (Projet de planification, Schéma / Support)
  const N_PAR_CLASSE = ['ci','cp','ce1','ce2','cm1','cm2']; // une ressource par classe (Emploi du temps, Fournitures)
  const GROUPES = [
    { group: 'exercices',            prefix: 'exercices-structuraux', title: 'Exercices structuraux',   niveaux: N_CE_CM },
    { group: 'calcul-mental',        prefix: 'calcul-mental',         title: 'Calcul mental',           niveaux: N_CE_CM },
    { group: 'concretisation',       prefix: 'concretisation',        title: 'Concrétisation',          niveaux: N_CE_CM },
    { group: 'projet-planification', prefix: 'projet-planification',  title: 'Projet de planification', niveaux: N_CI_CM },
    { group: 'schema-support',       prefix: 'schema-support',        title: 'Schéma / Support',        niveaux: N_CI_CM },
    { group: 'emploi-du-temps',      prefix: 'emploi-du-temps',       title: 'Emploi du temps',         niveaux: N_PAR_CLASSE },
    { group: 'fournitures-scolaires',prefix: 'fournitures-scolaires', title: 'Fournitures scolaires',   niveaux: N_PAR_CLASSE }
  ];
  const catalog = [];
  const groups = {};
  GROUPES.forEach(g => {
    const niveaux = g.niveaux.map(k => NIVEAUX[k]);
    groups[g.group] = { label: g.title, niveaux: niveaux.map(n => n.label) };
    niveaux.forEach(n => catalog.push({
      id: g.prefix + '-' + n.suffix,
      title: g.title + ' ' + n.label,
      group: g.group,
      niveau: n.label,
      classes: n.classes
    }));
  });
  window.RESOURCES_CATALOG = catalog;
  window.RESOURCE_GROUPS = groups;
})();
