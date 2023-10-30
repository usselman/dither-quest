let img;
let ditheredImg;

function setup() {
    const canvas = createCanvas(600, 480);
    canvas.center('horizontal');
    background(220);

    // File input
    input = createFileInput(handleFile);
    input.position(canvas.x, canvas.y);

    // Download button
    button = createButton('Download');
    button.position(canvas.x, canvas.y + 30);
    button.mousePressed(downloadImage);
}

function draw() {
    if (img) {
        image(img, 0, 50, width, height - 50);
    }
}

function handleFile(file) {
    if (file.type === 'image') {
        img = loadImage(file.data, () => {
            ditherImage();
        });
    }
}

function ditherImage() {
    img.loadPixels();
    for (let y = 0; y < img.height; y += .75) {
        for (let x = 0; x < img.width; x += .75) {
            const index = (x + y * img.width) * 4;
            const gray = (img.pixels[index] + img.pixels[index + 1] + img.pixels[index + 2]) / 3;
            const newColor = gray > 128 ? 255 : 0;
            img.pixels[index] = newColor / 2;
            img.pixels[index + 1] = newColor * 2;
            img.pixels[index + 2] = newColor;
        }
    }
    img.updatePixels();
}

function downloadImage() {
    if (img) {
        save(img, 'dithered_image.png');
    }
}


