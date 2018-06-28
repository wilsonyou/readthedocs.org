var gulp = require('gulp'),
    gulp_util = require('gulp-util'),
    watch = require('gulp-watch'),
    rename = require('gulp-rename'),
    run = require('gulp-run'),
    less = require('gulp-less'),
    browserify = require('browserify'),
    uglify = require('gulp-uglify'),
    vinyl_source = require('vinyl-source-stream'),
    vinyl_buffer = require('vinyl-buffer'),
    es = require('event-stream'),
    path = require('path'),
    eslint = require('gulp-eslint'),
    pkg_config = require('./package.json');

// Applications with primary static sources. We define these here to avoid
// picking up dependencies of the primary entry points and putting any
// limitations on directory structure for entry points.
var sources = {
    builds: {'js/detail.js': {}},
    core: {
        'js/readthedocs-doc-embed.js': {},
        'js/site.js': {},
        'css/badge_only.css': {src: 'node_modules/sphinx_rtd_theme/sphinx_rtd_theme/static/css/badge_only.css'},
        'css/theme.css': {src: 'node_modules/sphinx_rtd_theme/sphinx_rtd_theme/static/css/theme.css'},

        'font/fontawesome-webfont.eot': {src: 'node_modules/font-awesome/fonts/fontawesome-webfont.eot'},
        'font/fontawesome-webfont.svg': {src: 'node_modules/font-awesome/fonts/fontawesome-webfont.svg'},
        'font/fontawesome-webfont.ttf': {src: 'node_modules/font-awesome/fonts/fontawesome-webfont.ttf'},
        'font/fontawesome-webfont.woff': {src: 'node_modules/font-awesome/fonts/fontawesome-webfont.woff'},
        'font/fontawesome-webfont.woff2': {src: 'node_modules/font-awesome/fonts/fontawesome-webfont.woff2'},
        'font/FontAwesome.otf': {src: 'node_modules/font-awesome/fonts/FontAwesome.otf'}
    },
    projects: {
        'js/tools.js': {},
        'js/import.js': {},
        'css/import.less': {},
        'css/admin.less': {}
    },
    gold: {'js/gold.js': {}}
};

// Standalone application to create vendor bundles for. These can be imported
// with require in the browser or with Node during testing.
var standalone = {
    'jquery': {standalone: 'jquery'},
    'knockout': {},
    'jquery-migrate': {standalone: 'jquery-migrate'},
    'jquery-ui': {standalone: 'jquery-ui'},
    'underscore': {standalone: '_'}
};

// Build application call, wraps building entry point files for a single
// application. This is called by build and dev tasks.
function build_app_sources (application, minify) {
    // Normalize file glob lists
    var bundles = Object.keys(sources[application]).map(function (entry_path) {
        var bundle_path = path.join(
                pkg_config.name, application, 'static-src', application, entry_path),
            output_path = path.join(application, entry_path),
            bundle_config = sources[application][entry_path] || {},
            bundle;

        if (/\.js$/.test(bundle_path)) {
            // Javascript sources
            bundle = browserify(bundle_path)
                .bundle()
                ;

            if (minify) {
                bundle = bundle
                    .pipe(vinyl_source(path.basename(bundle_path)))
                    .pipe(vinyl_buffer())
                    .pipe(uglify())
                    .on('error', function (ev) {
                        gulp_util.beep();
                        gulp_util.log('Uglify error:', ev.message);
                    })
                    ;
            }

            bundle = bundle.pipe(rename(output_path));
        }
        else if (/\.less$/.test(bundle_path)) {
            // LESS sources
            output_path = path.join(
                path.dirname(output_path),
                path.basename(output_path, '.less') + '.css'
            );
            console.log(output_path);
            bundle = gulp.src(bundle_path)
                .pipe(less({}))
                .pipe(rename(output_path))
                .on('error', function (ev) {
                    gulp_util.beep();
                    gulp_util.log('LESS error:', ev.message);
                });
        }
        else {
            // Copy only sources
            bundle = gulp;
            if (bundle_config.src) {
                bundle = bundle
                    .src(bundle_config.src)
                    .pipe(rename(output_path));
            }
            else {
                bundle = bundle
                    .src(bundle_path);
            }
        }

        return bundle;
    });

    return es.merge(bundles)
        .pipe(gulp.dest(path.join(pkg_config.name, application, 'static')));
}

// Build standalone vendor modules
function build_vendor_sources(data, cb_output) {
    bower_resolve.offline = true;
    bower_resolve.init(function () {
        var standalone_modules = Object.keys(standalone).map(function (module) {
            var vendor_options = standalone[module] || {},
                vendor_bundles = [];

            // Bundle vendor libs for import via require()
            vendor_bundles.push(
                browserify()
                .require(bower_resolve(module), {expose: module})
                .bundle()
                .pipe(vinyl_source(module + '.js'))
                .pipe(vinyl_buffer())
                .pipe(uglify())
                .pipe(gulp.dest(
                    path.join(pkg_config.name, 'static', 'vendor')
                ))
            );

            // Bundle standalone for legacy use. These should only be used on
            // old documentation that does not yet use the new bundles
            if (typeof(vendor_options.standalone) != 'undefined') {
                vendor_bundles.push(
                    browserify({standalone: vendor_options.standalone})
                    .require(bower_resolve(module))
                    .bundle()
                    .pipe(vinyl_source(module + '-standalone.js'))
                    .pipe(vinyl_buffer())
                    .pipe(uglify())
                    .pipe(gulp.dest(
                        path.join(pkg_config.name, 'static', 'vendor')
                    ))
                );
            }

            return es.merge(vendor_bundles);
        });

        es
            .merge(standalone_modules)
            .pipe(es.wait(function (err, body) {
                cb_output(null, data);
            }));
    });
}

/* Tasks */
gulp.task('build', function (done) {
    gulp_util.log('Building source files');

    es
        .merge(Object.keys(sources).map(function (n) {
            return build_app_sources(n, true);
        }))
        .pipe(es.wait(function (err, body) {
            gulp_util.log('Collecting static files');
            run('./manage.py collectstatic --noinput')
                .exec('', function (err) { done(err); });
        }));
});

gulp.task('vendor', function (done) {
    build_vendor_sources(null, done);
});

gulp.task('dev', function (done) {
    gulp_util.log('Continually building source files');

    es
        .merge(Object.keys(sources).map(function (application) {
            var files = [
                path.join(pkg_config.name, application, 'static-src', '**', '*.js'),
                path.join(pkg_config.name, application, 'static-src', '**', '*.less')
            ];
            return watch(files, {verbose: true, name: 'dev'}, function () {
                build_app_sources(application, false)
                    .pipe(es.wait(function (err, body) {
                        gulp_util.log('Collecting static files');
                        run('./manage.py collectstatic --noinput').exec('');
                    }));
            });
        }))
        .pipe(es.wait(function (err, body) {
            done(null);
        }));
});

gulp.task('lint', function (done) {
    var paths = Object.keys(sources).map(function(application) {
      return path.join(pkg_config.name, application, 'static-src', '**', '*.js');
    });
    return gulp
        .src(paths)
        .pipe(eslint())
        .pipe(eslint.format())
        .pipe(eslint.failAfterError());
});

gulp.task('default', ['build']);
