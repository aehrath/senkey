FROM php:8.3-cli

# curl extension is built-in to this image - no apt or pecl needed
# No Composer, no SDK - pure PHP with built-in curl

WORKDIR /app
COPY index.php .

EXPOSE 8080

CMD ["php", "-S", "0.0.0.0:8080", "index.php"]
