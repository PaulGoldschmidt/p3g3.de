# My Personal Blog 📝

Over the years, I had mutliple, often cringy websites which I was not fully happy with. After this started really bugging me, I decided to create a fresh blog look and infrastructure starting from scratch. You can find the deployed version of this repo both at the German Blog [p3g3.de](https://p3g3.de) and the translated blog at [blog.paul-goldschmidt.de](https://blog.paul-goldschmidt.de).

The closely related parent repository [PaulGoldschmidt/paul-goldschmidt.de](https://github.com/PaulGoldschmidt/paul-goldschmidt.de) is the design source for this Repository, implementing the design for my [mainsite](https://paul-goldschmidt.de) in the highly optimized JavaScript Framework [Astro](https://astro.build/).

## Features

The Website relies in its core on the Ghost 6.0 open-source CMS optimized for blogs, being 1000x better to use than Wordpress, which I've used previously. 

- Dynamic Background of the page, slowly changing over the day
- Command Palette (Cmd+K / Ctrl+K) for quick navigation and Actions
- Dark/light theme with preference persistence
- Automated blog sync to my staging environment and automatic blog translation for my english blog using a GitHub Workflow

## Migating from Wordpress

While migrating away from Wordpress, I wanted to maintain previous links from WP (format YYYY/MM/{posttitle}) to be rerouted to the Ghost CMS Scheme of just the {posttitle}. For this porpuse, I build a quick script to convert these links. You can find this script on [GitHub Gist](https://gist.github.com/PaulGoldschmidt/6635384c410108e1ab80ac9feaa060a9).


## Development Commands

- `npm run dev`        # Gulp watch with LiveReload (development)
- `npm run build`      # Compile CSS (PostCSS) and JS (concat+uglify) to assets/built/
- `npm run zip`        # Create goldschmidt-blog.zip for manual upload
- `npm test`           # Validate theme with gscan
- `npm run test:ci`    # Strict gscan validation (CI)

## License
This project is licensed under the MIT License. See [Licenses](https://github.com/StanfordBDHG/SwiftPackageTemplate/tree/main/LICENSES) for more information.

## Contributors
See [CONTRIBUTORS.md](https://github.com/StanfordBDHG/SwiftPackageTemplate/tree/main/CONTRIBUTORS.md) for a full list of all contributors.

![Paul Goldschmidt Logo](https://raw.githubusercontent.com/PaulGoldschmidt/paulgoldschmidt/main/logo/dark-smaller.png#gh-light-mode-only)
![Paul Goldschmidt Logo](https://raw.githubusercontent.com/PaulGoldschmidt/paulgoldschmidt/main/logo/light-smaller.png#gh-dark-mode-only)
