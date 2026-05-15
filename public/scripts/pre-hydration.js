(function() {
  try {
    var ATTR = 'bis_skin_checked';
    var clean = function(node) {
      if (!node) return;
      var nodes = node.querySelectorAll ? node.querySelectorAll('[' + ATTR + ']') : [];
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].removeAttribute(ATTR);
      }
      if (node.documentElement && node.documentElement.hasAttribute && node.documentElement.hasAttribute(ATTR)) {
        node.documentElement.removeAttribute(ATTR);
      }
      if (node.body && node.body.hasAttribute && node.body.hasAttribute(ATTR)) {
        node.body.removeAttribute(ATTR);
      }
    };
    clean(document);
    var mo = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'attributes' && m.target && m.target.removeAttribute) {
          m.target.removeAttribute(ATTR);
        }
        if (m.addedNodes) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var added = m.addedNodes[j];
            if (added && added.nodeType === 1 && added.removeAttribute) {
              added.removeAttribute(ATTR);
            }
            if (added && added.querySelectorAll) {
              var descendants = added.querySelectorAll('[' + ATTR + ']');
              for (var k = 0; k < descendants.length; k++) {
                descendants[k].removeAttribute(ATTR);
              }
            }
          }
        }
      }
    });
    if (document.documentElement) {
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [ATTR],
        subtree: true,
        childList: true
      });
    }
    setTimeout(function() {
      clean(document);
    }, 0);
    setTimeout(function() {
      clean(document);
    }, 50);
  } catch (_e) {}
})();
