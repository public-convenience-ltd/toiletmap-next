import { html } from 'hono/html';
import { JSX } from 'hono/jsx';

export const Layout = (props: { title: string; children: any }) => {
    return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${props.title} - Toilet Map Admin</title>
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
          .input {
            width: 100%;
            display: block;
            padding: var(--space-2xs);
            color: var(--color-blue);
            border: 1px solid var(--color-blue);
            margin-top: var(--space-3xs);
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
      </body>
    </html>
  `;
};
