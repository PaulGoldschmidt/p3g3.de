const {series, watch, src, dest, parallel} = require('gulp');
const pump = require('pump');

const livereload = require('gulp-livereload');
const postcss = require('gulp-postcss');
const zip = require('gulp-zip').default;
const concat = require('gulp-concat');
const uglify = require('gulp-uglify');

const {Transform} = require('stream');

const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');
const easyimport = require('postcss-easy-import');

function replaceVersion() {
    const version = require('./package.json').version;
    return new Transform({
        objectMode: true,
        transform(file, enc, cb) {
            if (file.isBuffer()) {
                file.contents = Buffer.from(
                    file.contents.toString().replace('%%VERSION%%', version)
                );
            }
            cb(null, file);
        }
    });
}

function serve(done) {
    livereload.listen();
    done();
}

const handleError = (done) => {
    return function (err) {
        if (err) {
            console.error(err);
        }
        return done(err);
    };
};

function hbs(done) {
    pump([
        src(['*.hbs', 'partials/**/*.hbs']),
        livereload()
    ], handleError(done));
}

function css(done) {
    pump([
        src('assets/css/screen.css', {sourcemaps: true}),
        postcss([
            easyimport,
            autoprefixer(),
            cssnano()
        ]),
        dest('assets/built/', {sourcemaps: '.'}),
        livereload()
    ], handleError(done));
}

function js(done) {
    pump([
        src(['node_modules/tocbot/dist/tocbot.js', 'assets/js/*.js'], {sourcemaps: true}),
        concat('main.js'),
        replaceVersion(),
        uglify(),
        dest('assets/built/', {sourcemaps: '.'}),
        livereload()
    ], handleError(done));
}

function zipper(done) {
    const filename = require('./package.json').name + '.zip';

    pump([
        src([
            '**',
            '!node_modules', '!node_modules/**',
            '!dist', '!dist/**',
            '!yarn-error.log',
            '!yarn.lock',
            '!package-lock.json',
            '!gulpfile.js'
        ]),
        zip(filename),
        dest('dist/')
    ], handleError(done));
}

const cssWatcher = () => watch('assets/css/**', css);
const jsWatcher = () => watch('assets/js/**', js);
const hbsWatcher = () => watch(['*.hbs', 'partials/**/*.hbs'], hbs);
const watcher = parallel(cssWatcher, jsWatcher, hbsWatcher);
const build = series(css, js);

exports.build = build;
exports.zip = series(build, zipper);
exports.default = series(build, serve, watcher);
