/* قائمة الجوال */
(function () {
  var b = document.querySelector('.menu'), l = document.querySelector('.links');
  if (!b || !l) return;
  function set(open) { l.classList.toggle('open', open); b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.innerHTML = open ? '&#10005;' : '&#9776;'; }
  b.addEventListener('click', function (e) { e.stopPropagation(); set(!l.classList.contains('open')); });
  l.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
  document.addEventListener('click', function (e) { if (!e.target.closest('nav')) set(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
  window.addEventListener('resize', function () { if (window.innerWidth > 860) set(false); });
})();
