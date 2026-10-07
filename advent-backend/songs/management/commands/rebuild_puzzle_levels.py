"""Rebuild puzzle levels nobody has opened, with the current generator.

Levels are built once and kept, so an improvement to the generator (the
theme's own words, the distinctive vocabulary, the board that fits a phone)
only reaches levels built after it. Levels that no one has opened yet can be
rebuilt in place without moving a board under anyone: same id, new letters.
A level someone has started — or any Daily Puzzle — is never touched.

    python manage.py rebuild_puzzle_levels --dry-run
    python manage.py rebuild_puzzle_levels
    python manage.py rebuild_puzzle_levels --theme the-gospels --language sw
"""
from django.core.management.base import BaseCommand

from songs.models import PuzzleTheme, WordPuzzle
from songs.puzzle import generate, reset_dictionary, reset_theme_words


class Command(BaseCommand):
    help = 'Rebuild word-puzzle levels that no player has opened yet.'

    def add_arguments(self, parser):
        parser.add_argument('--theme', help='Only this theme (slug).')
        parser.add_argument('--language', help='Only this language (en, sw).')
        parser.add_argument('--dry-run', action='store_true', help='Say what would be rebuilt.')

    def handle(self, *args, **options):
        reset_dictionary()
        reset_theme_words()
        levels = (WordPuzzle.objects.filter(day__isnull=True, progress__isnull=True)
                  .select_related('theme').order_by('theme__order', 'language', 'level'))
        if options['theme']:
            if not PuzzleTheme.objects.filter(slug=options['theme']).exists():
                self.stderr.write('No theme "%s".' % options['theme'])
                return
            levels = levels.filter(theme__slug=options['theme'])
        if options['language']:
            levels = levels.filter(language=options['language'])

        rebuilt = failed = 0
        for puzzle in levels:
            label = f'{puzzle.theme.slug} {puzzle.language} level {puzzle.level}'
            if options['dry_run']:
                self.stdout.write(f'would rebuild {label}')
                rebuilt += 1
                continue
            try:
                fresh = generate(puzzle.theme, puzzle.level, force=True, language=puzzle.language)
            except ValueError as exc:
                failed += 1
                self.stderr.write(f'{label}: {exc} (left as it was)')
                continue
            rebuilt += 1
            self.stdout.write(f'{label}: {fresh.words}')
        verb = 'Would rebuild' if options['dry_run'] else 'Rebuilt'
        self.stdout.write(self.style.SUCCESS(f'{verb} {rebuilt} level(s); {failed} could not be rebuilt.'))
