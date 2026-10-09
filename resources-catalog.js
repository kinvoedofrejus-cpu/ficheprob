/* Catalogue des ressources didactiques (onglet "Ressources"), rangées dans
   "Structure". Chaque entrée correspond à un PDF + meta.json déposés dans R2
   sous resource-pdfs/{id}.pdf et resource-pdfs/{id}.meta.json (voir
   admin-upload-resources.html / admin-upload-resource-pdf.js).
   - category : 'structure' (seul dossier racine affiché)
   - group    : 'exercices' (liste directe dans Structure) ou 'calcul-mental'
                (dossier "CALCUL MENTAL" dans Structure, même chemin que les exercices)
   - classes  : sert uniquement à l'affichage sous le titre.
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
    { group: 'exercices',     prefix: 'exercices-structuraux', title: 'Exercices structuraux' },
    { group: 'calcul-mental', prefix: 'calcul-mental',         title: 'Calcul mental' }
  ];
  const catalog = [];
  GROUPES.forEach(g => NIVEAUX.forEach(n => catalog.push({
    id: g.prefix + '-' + n.suffix,
    title: g.title + ' ' + n.label,
    category: 'structure',
    group: g.group,
    classes: n.classes
  })));
  window.RESOURCES_CATALOG = catalog;
  window.RESOURCE_GROUPS = {
    'exercices':     { label: 'Exercices structuraux' },
    'calcul-mental': { label: 'CALCUL MENTAL' }
  };
})();
