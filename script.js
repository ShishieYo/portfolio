(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Footer year
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Tenure calculation (role started 2021) — static markup already shows a
  // correct value for today; this just keeps it accurate on future visits.
  const tenureEl = document.getElementById('tenureStat');
  if (tenureEl) {
    const years = new Date().getFullYear() - 2021;
    if (years > 0) tenureEl.textContent = `${years}+`;
  }

  // Sticky header state
  const header = document.getElementById('siteHeader');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Mobile nav toggle
  const navToggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');
  if (navToggle && mobileNav) {
    const closeMenu = () => {
      navToggle.setAttribute('aria-expanded', 'false');
      mobileNav.hidden = true;
    };
    navToggle.addEventListener('click', () => {
      const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!isOpen));
      mobileNav.hidden = isOpen;
    });
    mobileNav.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mobileNav.hidden) {
        closeMenu();
        navToggle.focus();
      }
    });
  }

  // Smooth scroll with sticky-header offset
  const headerHeight = () => (header ? header.offsetHeight : 0);
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', function (evt) {
      const id = this.getAttribute('href').slice(1);
      const section = document.getElementById(id);
      if (!section) return;
      evt.preventDefault();
      const targetY = window.pageYOffset + section.getBoundingClientRect().top - headerHeight() - 12;
      window.scrollTo({ top: targetY, behavior: reducedMotion ? 'auto' : 'smooth' });
      history.replaceState(null, '', `#${id}`);
    });
  });

  // Scroll-spy for primary nav
  const navLinks = document.querySelectorAll('.site-nav ul a[data-nav]');
  const spyTargets = Array.from(navLinks)
    .map((a) => document.getElementById(a.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (navLinks.length && spyTargets.length && 'IntersectionObserver' in window) {
    const spyObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const link = document.querySelector(`.site-nav ul a[href="#${entry.target.id}"]`);
          if (!link) return;
          if (entry.isIntersecting) {
            navLinks.forEach((l) => l.removeAttribute('aria-current'));
            link.setAttribute('aria-current', 'true');
          }
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    spyTargets.forEach((el) => spyObserver.observe(el));
  }

  // Scroll-reveal, progressive enhancement: elements are fully visible by
  // default in the HTML/CSS; JS only opts them into the hidden->fade-in
  // treatment, and a safety timeout guarantees nothing stays stuck hidden.
  if (!reducedMotion && 'IntersectionObserver' in window) {
    const revealTargets = document.querySelectorAll('.section, .case-study, .stat, .skills-group');
    revealTargets.forEach((el) => el.classList.add('reveal-ready'));
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    revealTargets.forEach((el) => revealObserver.observe(el));
    window.setTimeout(() => {
      document.querySelectorAll('.reveal-ready:not(.is-visible)').forEach((el) => el.classList.add('is-visible'));
    }, 3000);
  }

  // Contact form submission
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = form.action || '';
      const msgEl = document.getElementById('formMsg');
      const submitBtn = form.querySelector('button[type="submit"]');
      if (!url) {
        if (msgEl) msgEl.textContent = 'Form not configured. Please try again later.';
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await fetch(url, { method: 'POST', body: new FormData(form) });
        if (res.ok) {
          if (msgEl) msgEl.textContent = 'Thanks — I received your message and will reply within 24–48 hours.';
          form.reset();
        } else if (msgEl) {
          msgEl.textContent = 'There was an issue sending the message. Please try again later.';
        }
      } catch (err) {
        if (msgEl) msgEl.textContent = 'Network error — please try again later.';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  console.log('%cStill debugging in production — like everyone else.', 'color:#0B6358;font-weight:600;font-size:12px;');
})();
