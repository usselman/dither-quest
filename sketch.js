let img;
let ditheredImg;
let rSlider, gSlider, bSlider;
let randomizeButton;

function setup() {
    const canvas = createCanvas(600, 480);
    canvas.center('horizontal');
    background(220);

    // Parent div for the controls
    const controlsDiv = createDiv('');
    controlsDiv.id('controls');
    controlsDiv.style('text-align', 'justify-between', 'center'); // Center align the controls
    controlsDiv.position(canvas.x, windowHeight - 220); // Position right below the canvas

    // Sliders for RGB dithering effect
    rSlider = createSlider(50, 255, random(50, 255));
    rSlider.position(canvas.x, canvas.y + 30);
    gSlider = createSlider(50, 255, random(50, 255));
    gSlider.position(canvas.x, canvas.y + 50);
    bSlider = createSlider(50, 255, random(50, 255));
    bSlider.position(canvas.x, canvas.y + 70);

    // Randomize button
    randomizeButton = createButton('Randomize');
    randomizeButton.parent(controlsDiv);
    randomizeButton.mousePressed(randomizeColors);

    // File input
    input = createFileInput(handleFile);
    input.parent(controlsDiv);

    // Download button
    button = createButton('Download');
    button.parent(controlsDiv);
    button.mousePressed(downloadImage);

}

function draw() {
    if (img) {
        image(img, 0, 100, width, height - 100);
        ditherImage(); // Call ditherImage in draw to update in real-time
    }
}

function handleFile(file) {
    if (file.type === 'image') {
        img = loadImage(file.data, () => {
            ditherImage();
        });
    }
}

function randomizeColors() {

    rSlider.value(random(50, 255));
    gSlider.value(random(50, 255));
    bSlider.value(random(50, 255));

    if (img) {
        ditherImage();
    }
}

function ditherImage() {
    img.loadPixels();
    for (let y = 0; y < img.height; y += 0.75) {
        for (let x = 0; x < img.width; x += 0.75) {
            const index = (x + y * img.width) * 4;
            const gray = (img.pixels[index] + img.pixels[index + 1] + img.pixels[index + 2]) / 3;
            const threshold = 128; // Define a threshold for dithering
            if (gray > threshold) {
                img.pixels[index] = rSlider.value();
                img.pixels[index + 1] = gSlider.value();
                img.pixels[index + 2] = bSlider.value();
            } else {
                img.pixels[index] = 0;
                img.pixels[index + 1] = 0;
                img.pixels[index + 2] = 0;
            }
        }
    }
    img.updatePixels();
}

function downloadImage() {
    if (img) {
        save(img, 'dithered_image.png');
    }
}
