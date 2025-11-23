import { html } from 'hono/html';

export const Layout = (props: { title: string; children: any }) => {
    return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${props.title} - Toilet Map Admin</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"
        />
        <style>
          :root {
            /* Colors */
            --color-primary-navy: #0a165e;
            --color-accent-turquoise: #92f9db;
            --color-accent-pink: #ed3d62;
            --color-frost-ice: #d2fff2;
            --color-base-white: #ffffff;
            --color-light-grey: #f4f4f4;
            --color-neutral-grey: #807f7f;
            --color-aqua-accent: #93f9db;
            --color-blue: var(--color-primary-navy);
            --color-turquoise: var(--color-accent-turquoise);
            --color-pink: var(--color-accent-pink);
            --color-white: var(--color-base-white);

            /* Spacing */
            --space-3xs: clamp(0.25rem, calc(0.23rem + 0.11vw), 0.31rem);
            --space-2xs: clamp(0.5rem, calc(0.48rem + 0.11vw), 0.56rem);
            --space-xs: clamp(0.75rem, calc(0.71rem + 0.22vw), 0.88rem);
            --space-s: clamp(1rem, calc(0.96rem + 0.22vw), 1.13rem);
            --space-m: clamp(1.5rem, calc(1.43rem + 0.33vw), 1.69rem);
            --space-l: clamp(2rem, calc(1.91rem + 0.43vw), 2.25rem);
            --space-xl: clamp(3rem, calc(2.87rem + 0.65vw), 3.38rem);
            --space-2xl: clamp(4rem, calc(3.83rem + 0.87vw), 4.5rem);
            --space-3xl: clamp(6rem, calc(5.74rem + 1.3vw), 6.75rem);

            /* Typography */
            --font-family: 'Open Sans', sans-serif;
            --text--2: clamp(0.69rem, calc(0.69rem + 0.04vw), 0.72rem);
            --text--1: clamp(0.83rem, calc(0.81rem + 0.12vw), 0.9rem);
            --text-0: clamp(1rem, calc(0.96rem + 0.22vw), 1.13rem);
            --text-1: clamp(1.2rem, calc(1.13rem + 0.36vw), 1.41rem);
            --text-2: clamp(1.44rem, calc(1.33rem + 0.55vw), 1.76rem);
            --text-3: clamp(1.73rem, calc(1.56rem + 0.82vw), 2.2rem);
            --text-4: clamp(2.07rem, calc(1.84rem + 1.17vw), 2.75rem);
            --text-5: clamp(2.49rem, calc(2.16rem + 1.64vw), 3.43rem);

            /* Layout */
            --toilet-max-width: 1680px;
            --toilet-article-max-width: 75ch;
            --toilet-gutter: var(--space-l);
          }

          body {
            font-family: var(--font-family);
            line-height: 1.5;
            color: var(--color-primary-navy);
            margin: 0;
            background-color: var(--color-base-white);
          }

          .visually-hidden {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }

          /* Header */
          .header { background: var(--color-white); padding-block: var(--space-xs); border-bottom: 1px solid var(--color-light-grey); }
          .header__stack { display: flex; align-items: center; justify-content: space-between; width: 100%; }
          .header__nav { list-style: none; margin: 0; display: flex; gap: var(--space-m); font-weight: 600; }
          .header__nav a { text-decoration: none; color: var(--color-primary-navy); }
          .header__nav a:hover { color: var(--color-accent-pink); }

          /* Layout Helpers */
          .center { box-sizing: content-box; margin-inline: auto; max-inline-size: var(--toilet-max-width); }
          .center--gutter { padding-inline: var(--toilet-gutter); }
          
          /* Button */
          .button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 34px;
            padding: 0 var(--space-s);
            border: 2px solid var(--color-turquoise);
            border-radius: 17px;
            font-weight: bold;
            color: var(--color-blue);
            background-color: var(--color-turquoise);
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .button:hover { background-color: var(--color-blue); color: var(--color-turquoise); border-color: var(--color-blue); }
          
          /* Inputs */
          .input,
          .text-area {
            width: 100%;
            display: block;
            padding: var(--space-xs);
            color: var(--color-blue);
            border: 2px solid var(--color-light-grey);
            border-radius: 8px;
            font-family: inherit;
            font-size: var(--text-0);
            transition: all 0.2s ease;
            background: var(--color-white);
          }
          .input:hover,
          .text-area:hover {
            border-color: var(--color-aqua-accent);
          }
          .input:focus,
          .text-area:focus {
            outline: none;
            border-color: var(--color-primary-navy);
            box-shadow: 0 0 0 3px rgba(10, 22, 94, 0.1);
          }
          .input {
            margin-top: var(--space-3xs);
          }
          .text-area {
            resize: vertical;
            min-height: 100px;
          }
          
          /* Form labels */
          .form-label {
            font-weight: 600;
            color: var(--color-primary-navy);
            font-size: var(--text-0);
          }
          
          /* Form errors */
          .form-error {
            display: block;
            color: var(--color-accent-pink);
            font-size: var(--text--1);
            font-weight: 600;
            margin-top: var(--space-2xs);
            padding-left: var(--space-xs);
            border-left: 3px solid var(--color-accent-pink);
          }
          
          /* Section headings */
          h2 {
            font-size: var(--text-2);
            font-weight: 700;
            color: var(--color-primary-navy);
            margin: 0 0 var(--space-m) 0;
          }
          
          /* Tri-state toggle - slimline & elegant */
          .tri-state-container {
            display: inline-flex;
            background: var(--color-light-grey);
            border-radius: 20px;
            padding: 3px;
            gap: 2px;
          }
          .tri-state-option {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
            position: relative;
          }
          .tri-state-option:hover .tri-state-label {
            color: var(--color-primary-navy);
          }
          .tri-state-option input[type="radio"] {
            position: absolute;
            opacity: 0;
            pointer-events: none;
            width: 0;
            height: 0;
          }
          .tri-state-label {
            padding: var(--space-2xs) var(--space-s);
            border-radius: 17px;
            transition: all 0.15s ease;
            font-size: var(--text--1);
            font-weight: 500;
            color: var(--color-neutral-grey);
            white-space: nowrap;
          }
          .tri-state-option input[type="radio"]:checked + .tri-state-label {
            background: var(--color-turquoise);
            color: var(--color-primary-navy);
            font-weight: 700;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
          }

          /* Data layout */
          .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-m);
            margin-bottom: var(--space-l);
            flex-wrap: wrap;
          }

          .insights-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: var(--space-m);
            margin-bottom: var(--space-l);
          }

          .insight-card {
            border-radius: 16px;
            padding: var(--space-m);
            background: linear-gradient(145deg, var(--color-white), var(--color-frost-ice));
            border: 1px solid rgba(10, 22, 94, 0.08);
            box-shadow: 0 8px 25px rgba(10, 22, 94, 0.08);
            position: relative;
            overflow: hidden;
          }
          .insight-card--accent {
            background: linear-gradient(160deg, rgba(146, 249, 219, 0.25), rgba(237, 61, 98, 0.05));
          }
          .insight-title {
            font-size: var(--text--1);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--color-neutral-grey);
          }
          .insight-value {
            font-size: var(--text-3);
            font-weight: 700;
            margin: var(--space-2xs) 0;
          }
          .insight-meta {
            display: flex;
            align-items: center;
            gap: var(--space-3xs);
            font-size: var(--text--1);
            color: var(--color-primary-navy);
          }

          .sparkline {
            position: absolute;
            inset: auto 0 0 0;
            height: 50px;
            opacity: 0.15;
            pointer-events: none;
            background: linear-gradient(90deg, var(--color-pink), var(--color-blue));
            mask: radial-gradient(circle at 50% 50%, #000 55%, transparent 70%);
          }

          .table-container {
            background: var(--color-white);
            border-radius: 20px;
            border: 1px solid rgba(10, 22, 94, 0.08);
            box-shadow: 0 20px 45px rgba(10, 22, 94, 0.08);
            padding: var(--space-l);
          }

          .search-bar {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-s);
            align-items: center;
            margin-bottom: var(--space-m);
          }
          .search-form {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-s);
            flex: 1;
            align-items: center;
          }
          .search-input-wrapper {
            position: relative;
            flex: 1;
            min-width: 240px;
          }
          .search-input-wrapper i {
            position: absolute;
            left: var(--space-xs);
            top: 50%;
            transform: translateY(-50%);
            color: var(--color-neutral-grey);
          }
          .search-input {
            width: 100%;
            padding-left: calc(var(--space-l));
            padding-right: var(--space-l);
            border-radius: 16px;
            border: 2px solid rgba(10, 22, 94, 0.08);
            height: 48px;
            font-size: var(--text-0);
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
          }
          .search-input:focus {
            border-color: var(--color-primary-navy);
            box-shadow: 0 0 0 3px rgba(10, 22, 94, 0.12);
            outline: none;
          }
          .search-clear-btn {
            position: absolute;
            right: var(--space-xs);
            top: 50%;
            transform: translateY(-50%);
            border: none;
            background: none;
            color: var(--color-neutral-grey);
            cursor: pointer;
          }

          .filter-controls {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-s);
          }
          .filter-select-wrapper {
            display: flex;
            flex-direction: column;
          }
          .filter-select {
            min-width: 160px;
            border-radius: 999px;
            border: 1px solid rgba(10, 22, 94, 0.15);
            padding: var(--space-3xs) var(--space-s);
            height: 42px;
            font-weight: 600;
            background: rgba(210, 255, 242, 0.4);
            color: var(--color-primary-navy);
          }

          .active-filters {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3xs);
            margin-bottom: var(--space-s);
          }

          .filter-chip {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3xs);
            background: rgba(146, 249, 219, 0.35);
            border-radius: 999px;
            padding: 0 var(--space-xs);
            height: 32px;
            font-size: var(--text--1);
            font-weight: 600;
            color: var(--color-primary-navy);
          }
          .filter-chip button {
            border: none;
            background: none;
            cursor: pointer;
            color: inherit;
          }

          .table-overflow {
            overflow-x: auto;
          }
          .table-cell-primary strong {
            display: block;
            font-size: var(--text-0);
          }
          .table-cell-meta {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3xs);
            color: var(--color-neutral-grey);
            font-size: var(--text--1);
          }
          .table-cell-subtle {
            color: rgba(10, 22, 94, 0.6);
          }
          .table-chip-list {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-3xs);
            margin-top: var(--space-3xs);
          }
          .data-table {
            width: 100%;
            border-collapse: collapse;
          }
          .data-table th,
          .data-table td {
            padding: var(--space-s);
            text-align: left;
            border-bottom: 1px solid rgba(10, 22, 94, 0.08);
            font-size: var(--text--1);
          }
          .data-table th {
            font-size: var(--text-0);
            font-weight: 700;
            color: var(--color-primary-navy);
            background: rgba(10, 22, 94, 0.02);
          }
          .data-table tr:hover td {
            background: rgba(146, 249, 219, 0.1);
          }
          .data-table .sortable a {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3xs);
          }
          .sort-icon {
            color: rgba(10, 22, 94, 0.5);
            margin-left: var(--space-3xs);
          }

          .badge {
            display: inline-flex;
            align-items: center;
            gap: var(--space-3xs);
            border-radius: 999px;
            padding: 0 var(--space-xs);
            font-size: var(--text--1);
            font-weight: 700;
            letter-spacing: 0.03em;
            text-transform: uppercase;
            height: 26px;
          }
          .badge i {
            font-size: 0.8em;
          }
          .badge--yes {
            background: rgba(146, 249, 219, 0.35);
            color: var(--color-primary-navy);
          }
          .badge--no {
            background: rgba(237, 61, 98, 0.15);
            color: var(--color-accent-pink);
          }
          .badge--unknown {
            background: rgba(10, 22, 94, 0.08);
            color: var(--color-primary-navy);
          }
          .badge--neutral {
            background: rgba(10, 22, 94, 0.08);
            color: var(--color-primary-navy);
          }

          .empty-state {
            padding: var(--space-2xl);
            text-align: center;
            color: var(--color-neutral-grey);
          }
          .empty-state i {
            font-size: var(--text-4);
            color: var(--color-primary-navy);
            margin-bottom: var(--space-s);
          }

          .pagination {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-s);
            margin-top: var(--space-m);
          }
          .pagination-controls {
            display: inline-flex;
            gap: var(--space-3xs);
          }
          .pagination-btn {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 1px solid rgba(10, 22, 94, 0.15);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            text-decoration: none;
            color: var(--color-primary-navy);
            font-weight: 600;
          }
          .pagination-btn.active,
          .pagination-btn:hover {
            background: var(--color-primary-navy);
            color: var(--color-turquoise);
            border-color: var(--color-primary-navy);
          }
          .page-size-selector select {
            border-radius: 12px;
            border: 1px solid rgba(10, 22, 94, 0.15);
            padding: var(--space-3xs) var(--space-xs);
          }

          .legend-list {
            list-style: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: var(--space-3xs);
          }
          .legend-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-s);
          }
          .legend-label {
            display: flex;
            align-items: center;
            gap: var(--space-3xs);
          }
          .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
          }
          .stat-bar {
            width: 100%;
            height: 6px;
            border-radius: 999px;
            background: rgba(10, 22, 94, 0.1);
            overflow: hidden;
            margin-bottom: var(--space-3xs);
          }
          .stat-bar__fill {
            height: 100%;
            background: linear-gradient(90deg, var(--color-primary-navy), var(--color-accent-pink));
          }
        </style>
      </head>
      <body>
        <header class="header">
          <div class="center center--gutter">
            <div class="header__stack">
              <a href="/admin" style="font-weight: bold; font-size: var(--text-1); text-decoration: none; color: var(--color-primary-navy);">
                Toilet Map Admin
              </a>
              <nav>
                <ul class="header__nav">
                  <li><a href="/admin">Dashboard</a></li>
                  <li><a href="/admin/loos">Loos</a></li>
                  <li><a href="/admin/contributors">Contributors</a></li>
                  <li><a href="/admin/logout">Logout</a></li>
                </ul>
              </nav>
            </div>
          </div>
        </header>
        <main class="center center--gutter" style="padding-top: var(--space-l);">
          ${props.children}
        </main>
        <script>
          (function () {
            if (typeof window === 'undefined') {
              return;
            }

            const searchForms = window.document.querySelectorAll('[data-autosubmit="search"]');
            searchForms.forEach((form) => {
              const searchInput = form.querySelector('input[name="search"]');
              if (!searchInput) return;
              let timerId;
              searchInput.addEventListener('input', () => {
                window.clearTimeout(timerId);
                timerId = window.setTimeout(() => {
                  if (searchInput.value.trim().length === 0 && !form.dataset.allowEmpty) {
                    return;
                  }
                  form.requestSubmit();
                }, 350);
              });

              const clearBtn = form.querySelector('[data-clear-search]');
              if (clearBtn) {
                clearBtn.addEventListener('click', (event) => {
                  event.preventDefault();
                  searchInput.value = '';
                  const pageInput = form.querySelector('input[name="page"]');
                  if (pageInput) {
                    pageInput.setAttribute('value', '1');
                  }
                  form.requestSubmit();
                });
              }
            });
          })();
        </script>
      </body>
    </html>
  `;
};
