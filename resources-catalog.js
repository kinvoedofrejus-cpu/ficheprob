/* Catalogue des ressources didactiques (onglet "Ressources").
   L'onglet affiche une carte par type de ressource (GROUPES ci-dessous) ; chaque
   carte ouvre la même liste de chemins : CE1-CM2, CE1, CE2, CM1, CM2.
   Chaque entrée correspond à un PDF + meta.json déposés dans R2 sous
   resource-pdfs/{id}.pdf et resource-pdfs/{id}.meta.json (voir
   admin-upload-resources.html / admin-upload-resource-pdf.js).
   L'identifiant est « {prefix}-{suffix} », ex. exercices-structuraux-ce1-cm2,
   calcul-mental-ce2, concretisation-cm1, projet-planification-ce1-cm2,
   schema-support-cm2.
   - classes : sert uniquement à l'affichage sous le titre.
   1er téléchargement offert, paiement à partir du 2e (voir downloadResource). */
(function(){
  const NIVEAUX = [
    { suffix: 'ce1-cm2', label: 'CE1-CM2', classes: ['CE1','CE2','CM1','CM2'] },
    { suffix: 'ce1',     label: 'CE1',     classes: ['CE1'] },
    { suffix: 'ce2',     label: 'CE2',     classes: ['CE2'] },
    { suffix: 'cm1',     label: 'CM1',     classes: ['CM1'] },
    { suffix: 'cm2',     label: 'CM2',     classes: ['CM2'] }
  ];
  const GROUPES = [
    { group: 'exercices',            prefix: 'exercices-structuraux', title: 'Exercices structuraux' },
    { group: 'calcul-mental',        prefix: 'calcul-mental',         title: 'Calcul mental' },
    { group: 'concretisation',       prefix: 'concretisation',        title: 'Concrétisation' },
    { group: 'projet-planification', prefix: 'projet-planification',  title: 'Projet de planification' },
    { group: 'schema-support',       prefix: 'schema-support',        title: 'Schéma / Support' }
  ];
  const catalog = [];
  const groups = {};
  GROUPES.forEach(g => {
    groups[g.group] = { label: g.title };
    NIVEAUX.forEach(n => catalog.push({
      id: g.prefix + '-' + n.suffix,
      title: g.title + ' ' + n.label,
      group: g.group,
      classes: n.classes
    }));
  });
  window.RESOURCES_CATALOG = catalog;
  window.RESOURCE_GROUPS = groups;
})();
