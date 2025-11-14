(function () {
  const key = 'theme';
  const root = document.documentElement;
  function apply(t) { root.setAttribute('data-theme', t); }
  const saved = localStorage.getItem(key);
  if (saved) apply(saved);
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const cur = root.getAttribute('data-theme') || 'light';
      const next = (cur === 'light') ? 'dark' : 'light';
      apply(next);
      localStorage.setItem(key, next);
    });
  }

  // --- Toast helper ---
  const toast = document.getElementById('toast');
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.hidden = false;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      toast.hidden = true;
    }, 3000);
  }

  // --- Live cart badge ---
  function setCartCount(n) {
    const el = document.getElementById('cartCount');
    if (el) el.textContent = n;
  }

  // --- Intercept Add-to-Cart forms for AJAX add ---
  document.querySelectorAll('form.add-to-cart').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const res = await fetch('/cart/add', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new URLSearchParams(fd)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setCartCount(data.count || 0);
          showToast('✅ Added to cart');
        } else {
          showToast('Item unavailable');
        }
      } else {
        showToast('Something went wrong');
      }
    });
  });
})();
